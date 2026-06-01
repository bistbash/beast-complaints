import type { InquiryRow } from '../lib/types.ts';
import { JUSTIFICATION } from '../lib/constants.ts';
import {
  defaultHtmlTemplate,
  defaultSubjectTemplate,
  type EmailTemplateKind,
} from '../lib/emailTemplate.ts';
import { renderEmailBodies } from '../lib/emailRender.ts';
import { resolveEmailFromName, resolveEmailCredentials } from './emailCredentials.ts';
import { getRefreshToken } from './emailConfig.ts';
import { getEmailTemplate } from './emailTemplates.ts';
import { listEmailAssetsBinary } from './emailAssets.ts';
import { sendGmailMessage } from './gmailSend.ts';

export async function buildClosingEmailContent(
  inquiry: InquiryRow,
  mode: 'preview' | 'send' = 'send',
): Promise<{
  subject: string;
  text: string;
  html: string;
  inlineImages: ReturnType<typeof renderEmailBodies>['inlineImages'];
}> {
  const creds = await resolveEmailCredentials();
  const fromName = resolveEmailFromName(creds);
  const kind: EmailTemplateKind =
    inquiry.justification === JUSTIFICATION.UNJUSTIFIED ? 'unjustified' : 'justified';

  const stored = await getEmailTemplate(kind);
  const assets = await listEmailAssetsBinary();

  return renderEmailBodies({
    subjectTemplate: stored.subjectTemplate || defaultSubjectTemplate(kind),
    htmlTemplate: stored.htmlTemplate || defaultHtmlTemplate(kind),
    inquiry,
    fromName,
    assets,
    mode,
  });
}

export type ClosingEmailResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function sendClosingEmail(inquiry: InquiryRow): Promise<ClosingEmailResult> {
  const to = inquiry.submitter_email?.trim();
  if (!to) {
    return { ok: false, reason: 'no_submitter_email' };
  }

  let config: { gmailAddress: string; refreshToken: string } | null;
  try {
    config = await getRefreshToken();
  } catch (err) {
    console.warn('[beast-complaints] email config error:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'encryption_not_configured' };
  }

  if (!config) {
    return { ok: false, reason: 'not_configured' };
  }

  const { subject, text, html, inlineImages } = await buildClosingEmailContent(inquiry, 'send');

  try {
    await sendGmailMessage({
      refreshToken: config.refreshToken,
      gmailAddress: config.gmailAddress,
      to,
      subject,
      text,
      html,
      inlineImages: inlineImages.map((img) => ({
        cid: img.cid,
        contentType: img.contentType,
        data: img.data,
        filename: `${img.assetKey}.img`,
      })),
    });
    return { ok: true };
  } catch (err) {
    console.warn('[beast-complaints] closing email send failed:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'send_failed' };
  }
}

export async function sendTestEmail(to: string): Promise<ClosingEmailResult> {
  let config: { gmailAddress: string; refreshToken: string } | null;
  try {
    config = await getRefreshToken();
  } catch {
    return { ok: false, reason: 'encryption_not_configured' };
  }
  if (!config) {
    return { ok: false, reason: 'not_configured' };
  }

  const subject = 'בדיקת חיבור Gmail — פניות לקוח';
  const text = 'זהו מייל בדיקה מהמערכת. אם קיבלת אותו, החיבור תקין.';
  const html = `<p dir="rtl">${text}</p>`;

  try {
    await sendGmailMessage({
      refreshToken: config.refreshToken,
      gmailAddress: config.gmailAddress,
      to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (err) {
    console.warn('[beast-complaints] test email failed:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'send_failed' };
  }
}
