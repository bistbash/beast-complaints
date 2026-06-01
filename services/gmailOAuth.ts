import crypto from 'crypto';
import { google } from 'googleapis';
import {
  requireEmailCredentials,
  resolveOAuthRedirectUri,
} from './emailCredentials.ts';
import { oauthSigningSecret, signOAuthState, verifyOAuthState } from '../lib/tokenCrypto.ts';

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

async function oauthClient() {
  const creds = await requireEmailCredentials();
  return new google.auth.OAuth2(
    creds.googleClientId,
    creds.googleClientSecret,
    resolveOAuthRedirectUri(creds),
  );
}

export interface OAuthStatePayload {
  n: string;
  exp: number;
  connectedBy: string;
}

export async function createOAuthState(connectedBy: string): Promise<string> {
  const creds = await requireEmailCredentials();
  const payload = Buffer.from(
    JSON.stringify({
      n: crypto.randomBytes(16).toString('hex'),
      exp: Date.now() + 10 * 60 * 1000,
      connectedBy,
    } satisfies OAuthStatePayload),
  ).toString('base64url');
  const secret = oauthSigningSecret(creds.tokenEncryptionKey, creds.googleClientSecret);
  return signOAuthState(payload, secret);
}

export async function parseOAuthState(state: string): Promise<OAuthStatePayload | null> {
  const creds = await requireEmailCredentials().catch(() => null);
  if (!creds) return null;
  const secret = oauthSigningSecret(creds.tokenEncryptionKey, creds.googleClientSecret);
  const payload = verifyOAuthState(state, secret);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return null;
    if (!parsed.connectedBy) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getAuthorizationUrl(state: string): Promise<string> {
  const client = await oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [GMAIL_SEND_SCOPE],
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{
  refreshToken: string;
  gmailAddress: string;
}> {
  const client = await oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('missing_refresh_token');
  }
  client.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: client });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const gmailAddress = profile.data.emailAddress;
  if (!gmailAddress) {
    throw new Error('missing_gmail_address');
  }

  return { refreshToken: tokens.refresh_token, gmailAddress };
}

export async function authenticatedClient(refreshToken: string) {
  const client = await oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
