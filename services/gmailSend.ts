import { google } from 'googleapis';
import { resolveEmailCredentials, resolveEmailFromName } from './emailCredentials.ts';
import { authenticatedClient } from './gmailOAuth.ts';

export interface InlineImageAttachment {
  cid: string;
  contentType: string;
  data: Buffer;
  filename?: string;
}

async function fromHeader(gmailAddress: string): Promise<string> {
  const creds = await resolveEmailCredentials();
  const name = resolveEmailFromName(creds);
  const encoded = `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`;
  return `${encoded} <${gmailAddress}>`;
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function buildRawMime(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  inlineImages?: InlineImageAttachment[];
}): string {
  const images = input.inlineImages?.filter((img) => img.data.length > 0) ?? [];
  const altBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const relatedBoundary = `rel_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const plainPart = [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.text, 'utf8').toString('base64'),
    '',
  ];

  const htmlPart = [
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.html, 'utf8').toString('base64'),
    '',
  ];

  const lines: string[] = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    'MIME-Version: 1.0',
  ];

  if (images.length === 0) {
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`, '');
    lines.push(`--${altBoundary}`, ...plainPart);
    lines.push(`--${altBoundary}`, ...htmlPart);
    lines.push(`--${altBoundary}--`);
    return lines.join('\r\n');
  }

  lines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`, '');
  lines.push(`--${relatedBoundary}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`, '');
  lines.push(`--${altBoundary}`, ...plainPart);
  lines.push(`--${altBoundary}`, ...htmlPart);
  lines.push(`--${altBoundary}--`, '');

  for (const img of images) {
    const filename = img.filename || `${img.cid.replace(/@.*/, '')}.img`;
    lines.push(
      `--${relatedBoundary}`,
      `Content-Type: ${img.contentType}`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${filename}"`,
      '',
      img.data.toString('base64'),
      '',
    );
  }

  lines.push(`--${relatedBoundary}--`);
  return lines.join('\r\n');
}

export async function sendGmailMessage(input: {
  refreshToken: string;
  gmailAddress: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  inlineImages?: InlineImageAttachment[];
}): Promise<void> {
  const auth = await authenticatedClient(input.refreshToken);
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawMime({
    from: await fromHeader(input.gmailAddress),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    inlineImages: input.inlineImages,
  });
  const encoded = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });
}
