import { pool } from '../config/db.ts';
import { decryptSecret, encryptSecret } from '../lib/tokenCrypto.ts';
import {
  getEmailCredentialsPublic,
  requireEmailCredentials,
  resolveEmailCredentials,
} from './emailCredentials.ts';

export interface EmailConfigPublic {
  connected: boolean;
  gmailAddress: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  googleConfigured: boolean;
  encryptionConfigured: boolean;
  credentials: Awaited<ReturnType<typeof getEmailCredentialsPublic>>;
}

interface EmailConfigRow {
  gmail_address: string;
  refresh_token_enc: string;
  connected_by: string;
  connected_at: Date;
}

export function frontendAppUrl(): string {
  return (process.env.APP_URL || 'http://localhost:5180').replace(/\/+$/, '');
}

export async function isGoogleOAuthConfigured(): Promise<boolean> {
  const creds = await resolveEmailCredentials();
  return Boolean(creds?.googleClientId && creds?.googleClientSecret);
}

export async function isEncryptionConfigured(): Promise<boolean> {
  const creds = await resolveEmailCredentials();
  return Boolean(creds?.tokenEncryptionKey);
}

export async function getEmailConfigPublic(): Promise<EmailConfigPublic> {
  const credentials = await getEmailCredentialsPublic();
  const { rows } = await pool.query<EmailConfigRow>(
    `SELECT gmail_address, refresh_token_enc, connected_by, connected_at
       FROM complaints_email_config
      WHERE id = 1`,
  );
  const row = rows[0];
  return {
    connected: Boolean(row),
    gmailAddress: row?.gmail_address ?? null,
    connectedBy: row?.connected_by ?? null,
    connectedAt: row?.connected_at ? row.connected_at.toISOString() : null,
    googleConfigured: credentials.configured && credentials.hasClientSecret,
    encryptionConfigured: credentials.configured && credentials.hasEncryptionKey,
    credentials,
  };
}

export async function getRefreshToken(): Promise<{ gmailAddress: string; refreshToken: string } | null> {
  const { rows } = await pool.query<EmailConfigRow>(
    `SELECT gmail_address, refresh_token_enc FROM complaints_email_config WHERE id = 1`,
  );
  const row = rows[0];
  if (!row) return null;
  const creds = await requireEmailCredentials();
  return {
    gmailAddress: row.gmail_address,
    refreshToken: decryptSecret(row.refresh_token_enc, creds.tokenEncryptionKey),
  };
}

export async function saveEmailConfig(input: {
  gmailAddress: string;
  refreshToken: string;
  connectedBy: string;
  scopes?: string;
}): Promise<void> {
  const creds = await requireEmailCredentials();
  const enc = encryptSecret(input.refreshToken, creds.tokenEncryptionKey);
  await pool.query(
    `INSERT INTO complaints_email_config (id, gmail_address, refresh_token_enc, scopes, connected_by, connected_at, updated_at)
     VALUES (1, $1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       gmail_address = EXCLUDED.gmail_address,
       refresh_token_enc = EXCLUDED.refresh_token_enc,
       scopes = EXCLUDED.scopes,
       connected_by = EXCLUDED.connected_by,
       updated_at = NOW()`,
    [input.gmailAddress, enc, input.scopes || 'gmail.send', input.connectedBy],
  );
}

export async function deleteEmailConfig(): Promise<void> {
  await pool.query(`DELETE FROM complaints_email_config WHERE id = 1`);
}
