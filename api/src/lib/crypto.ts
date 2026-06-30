import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest(); // 32 bytes
}
export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}
export function decrypt(blob: string, secret: string): string {
  const [ivB, tagB, ctB] = blob.split('.');
  if (!ivB || !tagB || !ctB) throw new Error('Bad ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}
export function maskValue(v: string): string {
  if (!v || v.length < 4) return '••••';
  return '••••' + v.slice(-4);
}
