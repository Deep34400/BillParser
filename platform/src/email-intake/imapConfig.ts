/**
 * IMAP runtime config — Admin UI / DB only (no .env for mail).
 * Host/port are fixed Gmail defaults in code.
 */
import { getSettings, getProviderCredentials } from '../shared/settings.js';

export const IMAP_CREDS_PROVIDER = 'imap';

/** Fixed defaults — not from .env */
export const IMAP_DEFAULTS = {
  host: 'imap.gmail.com',
  port: 993,
  pollIntervalSec: 90,
} as const;

export interface ImapRuntimeConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  pollIntervalSec: number;
  enabled: boolean;
}

export async function getImapRuntimeConfig(): Promise<ImapRuntimeConfig> {
  const settings = await getSettings();
  const creds = await getProviderCredentials(IMAP_CREDS_PROVIDER);

  const user = (settings.emailIntakeUser || creds.user || '').trim();
  const password = (creds.password || '').replace(/\s+/g, '');
  const poll = Number(settings.emailIntakePollIntervalSec);
  const pollIntervalSec =
    Number.isFinite(poll) && poll >= 10 ? poll : IMAP_DEFAULTS.pollIntervalSec;

  return {
    host: IMAP_DEFAULTS.host,
    port: IMAP_DEFAULTS.port,
    user,
    password,
    pollIntervalSec,
    enabled: settings.emailIntakeEnabled === true,
  };
}
