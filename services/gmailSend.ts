import { google } from 'googleapis';
import { resolveEmailCredentials, resolveEmailFromName } from './emailCredentials.ts';
import { authenticatedClient } from './gmailOAuth.ts';

export interface InlineImageAttachment {
  cid: string;
  contentType: string;
  data: Buffer;
  filename?: string;
}

export interface FileAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
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

function encodeAttachmentFilename(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_') || 'attachment';
  const encoded = encodeURIComponent(filename);
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function buildRawMime(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  inlineImages?: InlineImageAttachment[];
  attachments?: FileAttachment[];
}): string {
  const images = input.inlineImages?.filter((img) => img.data.length > 0) ?? [];
  const files = input.attachments?.filter((f) => f.data.length > 0) ?? [];

  const altBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const relatedBoundary = `rel_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const mixedBoundary = `mix_${Date.now()}_${Math.random().toString(36).slice(2)}`;

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

  /** Body: alternative, or related (alternative + inline images). */
  const buildBodyPart = (): string[] => {
    if (images.length === 0) {
      return [
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        '',
        `--${altBoundary}`,
        ...plainPart,
        `--${altBoundary}`,
        ...htmlPart,
        `--${altBoundary}--`,
      ];
    }
    return [
      `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
      '',
      `--${relatedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      ...plainPart,
      `--${altBoundary}`,
      ...htmlPart,
      `--${altBoundary}--`,
      '',
      ...images.flatMap((img) => {
        const filename = img.filename || `${img.cid.replace(/@.*/, '')}.img`;
        return [
          `--${relatedBoundary}`,
          `Content-Type: ${img.contentType}`,
          'Content-Transfer-Encoding: base64',
          `Content-ID: <${img.cid}>`,
          `Content-Disposition: inline; filename="${filename}"`,
          '',
          img.data.toString('base64'),
          '',
        ];
      }),
      `--${relatedBoundary}--`,
    ];
  };

  const lines: string[] = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    'MIME-Version: 1.0',
  ];

  if (files.length === 0) {
    lines.push(...buildBodyPart());
    return lines.join('\r\n');
  }

  lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, '');
  lines.push(`--${mixedBoundary}`, ...buildBodyPart(), '');

  for (const file of files) {
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${file.contentType}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; ${encodeAttachmentFilename(file.filename)}`,
      '',
      file.data.toString('base64'),
      '',
    );
  }

  lines.push(`--${mixedBoundary}--`);
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
  attachments?: FileAttachment[];
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
    attachments: input.attachments,
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
