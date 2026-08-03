/**
 * IMAP Email Poller — connects to mailbox, fetches UNSEEN messages,
 * extracts valid attachments, and feeds them to the OCR pipeline.
 *
 * Design: connect → poll → disconnect each cycle (no idle connection).
 * Idle IMAP sockets cause ETIMEOUT and crash the process if unhandled.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env.js';
import { loadStore, isMessageSeen, markMessageSeen, hashBuffer, isFileSeen, markFileSeen } from './dedup.js';
import { loadWhitelist, refreshUserWhitelist, isSenderAllowed, getAllowedSendersSnapshot } from './whitelist.js';
import { filterAttachments, type RawAttachment } from './attachmentFilter.js';
import { ingestInvoice, type IngestRecord } from './ingest.js';

const INTAKE_DIR = resolve(process.cwd(), 'intake');
/** Max unread messages handled per poll cycle (newest first). Prevents backlog from blocking new invoices. */
const MAX_PER_POLL = 40;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

function log(msg: string): void {
  console.log(`[email-intake] ${new Date().toISOString()} — ${msg}`);
}

function ensureIntakeDir(): void {
  if (!existsSync(INTAKE_DIR)) mkdirSync(INTAKE_DIR, { recursive: true });
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

/** Gmail app passwords work with or without spaces — normalize. */
function imapPassword(): string {
  return env.imapPassword.replace(/\s+/g, '');
}

function createClient(): ImapFlow {
  const client = new ImapFlow({
    host: env.imapHost,
    port: env.imapPort,
    secure: true,
    auth: {
      user: env.imapUser,
      pass: imapPassword(),
    },
    logger: false,
    // Long enough for ~1–15 MB attachment download
    socketTimeout: 120_000,
    greetingTimeout: 30_000,
  });

  // CRITICAL: without this, Socket timeout kills the whole Node process
  client.on('error', (err: Error) => {
    log(`IMAP client error (non-fatal): ${err.message}`);
  });

  return client;
}

async function safeLogout(client: ImapFlow | null): Promise<void> {
  if (!client) return;
  try {
    if (client.usable) await client.logout();
    else client.close();
  } catch {
    try { client.close(); } catch { /* ignore */ }
  }
}

async function pollMailbox(): Promise<void> {
  if (running) {
    log('Poll already in progress, skipping');
    return;
  }
  running = true;

  // Check if admin disabled the service since last poll
  try {
    const { getSettings } = await import('../shared/settings.js');
    const settings = await getSettings();
    if (settings.emailIntakeEnabled === false) {
      log('Email intake disabled by admin — skipping poll');
      running = false;
      return;
    }
  } catch { /* proceed if settings unavailable */ }

  try {
    const wl = await refreshUserWhitelist();
    const snap = getAllowedSendersSnapshot();
    log(`Whitelist (from Admin UI/DB): ${snap.length ? snap.join(', ') : '(open — all senders allowed)'}` +
      ` [db=${wl.db.length}, users=${wl.users.length}]`);
  } catch {
    /* keep previous whitelist */
  }

  let client: ImapFlow | null = null;

  try {
    client = createClient();
    await client.connect();
    log(`Connected — polling UNSEEN in INBOX…`);

    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      // Newest first (highest UID = latest mail) so new invoices are not blocked by old bounce backlog
      const all = (Array.isArray(uids) ? uids : []).slice().sort((a, b) => Number(b) - Number(a));
      const list = all.slice(0, MAX_PER_POLL);

      if (all.length === 0) {
        log('No unread emails in INBOX');
      } else {
        log(`Found ${all.length} unread — processing newest ${list.length} first (uids ${list[0]}…${list[list.length - 1]})`);
      }

      let processed = 0;
      let accepted = 0;
      let quarantined = 0;
      let errors = 0;

      for (const uid of list) {
        try {
          // Phase 1: envelope only (fast) — quarantine without downloading body/attachments
          const meta = await client.fetchOne(uid, {
            uid: true,
            envelope: true,
          }, { uid: true });

          if (!meta) {
            errors++;
            continue;
          }

          const result = await handleMessage(client, meta, uid);
          processed++;
          if (result === 'accepted') accepted++;
          if (result === 'quarantined') quarantined++;
        } catch (err) {
          log(`ERROR processing uid=${uid}: ${err instanceof Error ? err.message : String(err)}`);
          errors++;
        }
      }

      log(`Poll complete: processed=${processed}, accepted=${accepted}, quarantined=${quarantined}, errors=${errors}, remaining_unread≈${Math.max(0, all.length - list.length)}`);
    } finally {
      lock.release();
    }
  } catch (err) {
    log(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await safeLogout(client);
    client = null;
    running = false;
  }
}

type HandleResult = 'accepted' | 'quarantined' | 'skipped' | 'error';

/**
 * Phase 1 uses envelope only. Full body/attachments downloaded only for whitelisted senders.
 */
async function handleMessage(client: ImapFlow, msg: any, uid: number): Promise<HandleResult> {
  const envelope = msg.envelope;
  const messageId = envelope?.messageId ?? '';
  const from = envelope?.from?.[0]?.address ?? '';
  const subject = envelope?.subject ?? '(no subject)';
  const date = envelope?.date ? new Date(envelope.date).toISOString() : new Date().toISOString();

  log(`Examining: from=${from} subject="${subject}" uid=${uid}`);

  if (messageId && isMessageSeen(messageId)) {
    log(`  Already processed Message-ID — marking Seen`);
    await markSeen(client, uid);
    return 'skipped';
  }

  if (!isSenderAllowed(from)) {
    log(`Quarantined: ${from} (not in whitelist) — subject: "${subject}"`);
    if (messageId) markMessageSeen(messageId, from, subject);
    await markSeen(client, uid);
    return 'quarantined';
  }

  // Phase 2: allowed sender — download full message for attachments
  log(`  Allowed sender — downloading attachments…`);
  const full = await client.fetchOne(uid, { uid: true, source: true }, { uid: true });
  if (!full || !('source' in full) || !full.source) {
    log(`  No message source for uid=${uid}`);
    return 'error';
  }

  const parsed = await simpleParser(full.source);
  const rawAttachments: RawAttachment[] = (parsed.attachments ?? []).map((att) => ({
    filename: att.filename ?? undefined,
    contentType: att.contentType,
    contentDisposition: att.contentDisposition,
    content: att.content,
    size: att.size || att.content?.length || 0,
  }));

  log(`  Attachments raw=${rawAttachments.length} sizes=[${rawAttachments.map((a) => `${Math.round((a.size || 0) / 1024)}KB`).join(', ')}]`);

  const { valid, skipped } = filterAttachments(rawAttachments);

  if (valid.length === 0) {
    log(`No valid attachments: ${from} — "${subject}" (skipped: ${skipped.join('; ') || 'none'})`);
    if (messageId) markMessageSeen(messageId, from, subject);
    await markSeen(client, uid);
    return 'skipped';
  }

  log(`Accepted: ${from} — "${subject}" — ${valid.length} attachment(s)`);
  ensureIntakeDir();

  for (const att of valid) {
    const fileHash = hashBuffer(att.content);
    if (isFileSeen(fileHash)) {
      log(`  Skip duplicate file: ${att.filename} (hash seen)`);
      continue;
    }

    const timestamp = Date.now();
    const savedFilename = `${timestamp}_${safeName(att.filename ?? 'attachment')}`;
    const savedPath = resolve(INTAKE_DIR, savedFilename);
    writeFileSync(savedPath, att.content);

    markFileSeen(fileHash, att.filename ?? 'attachment');

    const record: IngestRecord = {
      source: 'email',
      sender: from,
      subject,
      receivedAt: date,
      messageId,
      originalFilename: att.filename ?? 'attachment',
      savedPath,
      fileHash,
    };

    try {
      const billId = await ingestInvoice(att.content, record);
      log(`  Ingested: ${att.filename} (${Math.round(att.content.length / 1024)} KB) → bill ${billId}`);
    } catch (err) {
      log(`  Ingest FAILED for ${att.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (messageId) markMessageSeen(messageId, from, subject);
  await markSeen(client, uid);
  return 'accepted';
}

async function markSeen(client: ImapFlow, uid: number): Promise<void> {
  try {
    if (client.usable) {
      await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
    }
  } catch { /* best-effort */ }
}

export async function startEmailIntake(opts?: { force?: boolean }): Promise<void> {
  if (!env.imapUser || !env.imapPassword) {
    log('IMAP_USER or IMAP_PASSWORD not set. Skipping email intake.');
    return;
  }

  // Already running — don't create a second timer
  if (pollTimer) {
    log('Email intake already running.');
    return;
  }

  // Check DB setting first (admin toggle), fallback to env — skip check if force (called after enable)
  if (!opts?.force) {
    const { getSettings } = await import('../shared/settings.js');
    const settings = await getSettings();
    const enabled = settings.emailIntakeEnabled ?? env.imapEnabled;
    if (!enabled) {
      log('Email intake disabled (toggle off in admin settings). Skipping.');
      return;
    }
  }

  loadStore();
  loadWhitelist();
  await refreshUserWhitelist();
  log(`Starting email intake: ${env.imapUser}@${env.imapHost} (poll every ${env.pollIntervalSec}s)`);

  await pollMailbox();

  pollTimer = setInterval(() => {
    pollMailbox().catch((err) => log(`Scheduled poll error: ${err instanceof Error ? err.message : String(err)}`));
  }, env.pollIntervalSec * 1000);
}

export async function stopEmailIntake(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  log('Email intake stopped.');
}

/** True if the poll timer is currently scheduled. */
export function isEmailIntakeRunning(): boolean {
  return pollTimer !== null;
}
