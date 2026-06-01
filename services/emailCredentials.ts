import { pool } from '../config/db.ts';

export interface EmailCredentials {
  googleClientId: string;
  googleClientSecret: string;
  tokenEncryptionKey: string;
  oauthRedirectUri: string | null;
  emailFromName: string | null;
}

export interface EmailCredentialsPublic {
  configured: boolean;
  googleClientId: string | null;
  hasClientSecret: boolean;
  hasEncryptionKey: boolean;
  oauthRedirectUri: string | null;
  suggestedRedirectUri: string;
  emailFromName: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface CredentialsRow {
  google_client_id: string;
  google_client_secret: string;
  token_encryption_key: string;
  oauth_redirect_uri: string | null;
  email_from_name: string | null;
  updated_by: string;
  updated_at: Date;
}

let cache: EmailCredentials | null | undefined;

export function invalidateEmailCredentialsCache(): void {
  cache = undefined;
}

export function defaultOAuthRedirectUri(): string {
  const explicit = (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const port = process.env.PORT || '3050';
  return `http://localhost:${port}/api/settings/email/oauth/callback`;
}

function fromEnv(): EmailCredentials | null {
  const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const googleClientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const tokenEncryptionKey = (process.env.EMAIL_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!googleClientId || !googleClientSecret || !tokenEncryptionKey) {
    return null;
  }
  return {
    googleClientId,
    googleClientSecret,
    tokenEncryptionKey,
    oauthRedirectUri: (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim() || null,
    emailFromName: (process.env.EMAIL_FROM_NAME || '').trim() || null,
  };
}

async function fromDatabase(): Promise<EmailCredentials | null> {
  const { rows } = await pool.query<CredentialsRow>(
    `SELECT google_client_id, google_client_secret, token_encryption_key,
            oauth_redirect_uri, email_from_name, updated_by, updated_at
       FROM complaints_email_credentials
      WHERE id = 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    googleClientId: row.google_client_id,
    googleClientSecret: row.google_client_secret,
    tokenEncryptionKey: row.token_encryption_key,
    oauthRedirectUri: row.oauth_redirect_uri,
    emailFromName: row.email_from_name,
  };
}

/** DB credentials take precedence over .env (UI-managed). */
export async function resolveEmailCredentials(): Promise<EmailCredentials | null> {
  if (cache !== undefined) return cache;
  const db = await fromDatabase();
  cache = db ?? fromEnv();
  return cache;
}

export async function requireEmailCredentials(): Promise<EmailCredentials> {
  const creds = await resolveEmailCredentials();
  if (!creds) {
    throw new Error('email_credentials_not_configured');
  }
  return creds;
}

export function resolveOAuthRedirectUri(creds: EmailCredentials | null): string {
  const fromCreds = creds?.oauthRedirectUri?.trim();
  if (fromCreds) return fromCreds;
  return defaultOAuthRedirectUri();
}

export function resolveEmailFromName(creds: EmailCredentials | null): string {
  const fromCreds = creds?.emailFromName?.trim();
  if (fromCreds) return fromCreds;
  return (process.env.EMAIL_FROM_NAME || 'פניות לקוח').trim();
}

export async function getEmailCredentialsPublic(): Promise<EmailCredentialsPublic> {
  const { rows } = await pool.query<Pick<CredentialsRow, 'google_client_id' | 'oauth_redirect_uri' | 'email_from_name' | 'updated_by' | 'updated_at'>>(
    `SELECT google_client_id, oauth_redirect_uri, email_from_name, updated_by, updated_at
       FROM complaints_email_credentials
      WHERE id = 1`,
  );
  const row = rows[0];
  const env = fromEnv();
  const configured = Boolean(row || env);
  return {
    configured,
    googleClientId: row?.google_client_id ?? env?.googleClientId ?? null,
    hasClientSecret: Boolean(row || env?.googleClientSecret),
    hasEncryptionKey: Boolean(row || env?.tokenEncryptionKey),
    oauthRedirectUri: row?.oauth_redirect_uri ?? env?.oauthRedirectUri ?? null,
    suggestedRedirectUri: defaultOAuthRedirectUri(),
    emailFromName: row?.email_from_name ?? env?.emailFromName ?? null,
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ? row.updated_at.toISOString() : null,
  };
}

export function validateEncryptionKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'מפתח הצפנה חסר';
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  try {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length !== 32) return 'מפתח הצפנה חייב להיות 32 bytes (hex או base64)';
  } catch {
    return 'מפתח הצפנה לא תקין';
  }
  return null;
}

export async function saveEmailCredentials(input: {
  googleClientId: string;
  googleClientSecret?: string;
  tokenEncryptionKey?: string;
  oauthRedirectUri?: string | null;
  emailFromName?: string | null;
  updatedBy: string;
}): Promise<void> {
  const clientId = input.googleClientId.trim();
  if (!clientId) {
    throw new Error('google_client_id_required');
  }

  const existing = await fromDatabase();
  const clientSecret = (input.googleClientSecret || '').trim() || existing?.googleClientSecret;
  if (!clientSecret) {
    throw new Error('google_client_secret_required');
  }

  const encKey = (input.tokenEncryptionKey || '').trim() || existing?.tokenEncryptionKey;
  if (!encKey) {
    throw new Error('token_encryption_key_required');
  }
  const encErr = validateEncryptionKey(encKey);
  if (encErr) {
    throw new Error(encErr);
  }

  const oauthRedirectUri =
    input.oauthRedirectUri === undefined
      ? existing?.oauthRedirectUri ?? null
      : input.oauthRedirectUri?.trim() || null;

  const emailFromName =
    input.emailFromName === undefined ? existing?.emailFromName ?? null : input.emailFromName?.trim() || null;

  if (
    existing &&
    input.tokenEncryptionKey?.trim() &&
    input.tokenEncryptionKey.trim() !== existing.tokenEncryptionKey
  ) {
    const linked = await pool.query(`SELECT 1 FROM complaints_email_config WHERE id = 1`);
    if (linked.rowCount) {
      throw new Error('encryption_key_change_requires_disconnect');
    }
  }

  await pool.query(
    `INSERT INTO complaints_email_credentials (
       id, google_client_id, google_client_secret, token_encryption_key,
       oauth_redirect_uri, email_from_name, updated_by, updated_at
     ) VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       google_client_id = EXCLUDED.google_client_id,
       google_client_secret = EXCLUDED.google_client_secret,
       token_encryption_key = EXCLUDED.token_encryption_key,
       oauth_redirect_uri = EXCLUDED.oauth_redirect_uri,
       email_from_name = EXCLUDED.email_from_name,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [clientId, clientSecret, encKey, oauthRedirectUri, emailFromName, input.updatedBy],
  );
  invalidateEmailCredentialsCache();
}
