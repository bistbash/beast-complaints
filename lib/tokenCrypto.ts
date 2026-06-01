import crypto from 'crypto';

export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('encryption key is not configured');
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length !== 32) {
    throw new Error('encryption key must be 32 bytes (hex or base64)');
  }
  return buf;
}

/** AES-256-GCM — returns `iv:tag:ciphertext` (base64 segments). */
export function encryptSecret(plain: string, keyRaw: string): string {
  const key = parseEncryptionKey(keyRaw);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload: string, keyRaw: string): string {
  const key = parseEncryptionKey(keyRaw);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('invalid encrypted payload');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function signOAuthState(payload: string, signingSecret: string): string {
  const sig = crypto.createHmac('sha256', signingSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string, signingSecret: string): string | null {
  const idx = state.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = state.slice(0, idx);
  const sig = state.slice(idx + 1);
  const expected = crypto.createHmac('sha256', signingSecret).update(payload).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return payload;
}

export function oauthSigningSecret(tokenEncryptionKey: string, googleClientSecret: string): string {
  if (tokenEncryptionKey.trim()) return tokenEncryptionKey.trim();
  return googleClientSecret.trim();
}
