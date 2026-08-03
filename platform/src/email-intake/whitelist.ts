/**
 * Sender whitelist — only active users' intake_email values.
 * Admin assigns allowed sender per user (not a global list).
 * If no users have intake_email set → reject all senders.
 */
let userEmails: string[] = [];

/**
 * Refresh whitelist from user intake emails. Called every poll cycle.
 */
export async function refreshUserWhitelist(): Promise<{ db: string[]; users: string[] }> {
  try {
    const { listUsers } = await import('../users/repository.js');
    const users = await listUsers();
    userEmails = users
      .filter((u) => u.intake_email && u.intake_email.trim() && u.status === 'active')
      .map((u) => u.intake_email!.toLowerCase().trim());
  } catch {
    // keep existing userEmails on error
  }

  return { db: [], users: userEmails };
}

/** @deprecated no-op — whitelist comes from users via refreshUserWhitelist() */
export function loadWhitelist(): void {}

export function isSenderAllowed(from: string): boolean {
  if (userEmails.length === 0) return false; // no user senders configured → reject all
  const email = from.toLowerCase().trim();
  const domain = '@' + (email.split('@')[1] ?? '');
  return userEmails.some((entry) => entry === email || entry === domain);
}

export function getAllowedSendersSnapshot(): string[] {
  return [...userEmails];
}
