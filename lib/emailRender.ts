import type { InquiryRow } from './types.ts';
import { buildTemplateContext, renderTemplate } from './emailTemplate.ts';
import type { EmailAssetBinary } from '../services/emailAssets.ts';
import { buildAssetContext } from '../services/emailAssets.ts';

export interface InlineEmailImage {
  assetKey: string;
  contentType: string;
  data: Buffer;
  cid: string;
}

export interface RenderedEmailBodies {
  subject: string;
  html: string;
  text: string;
  inlineImages: InlineEmailImage[];
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderEmailBodies(input: {
  subjectTemplate: string;
  htmlTemplate: string;
  inquiry: InquiryRow;
  fromName: string;
  assets: EmailAssetBinary[];
  mode: 'preview' | 'send';
}): RenderedEmailBodies {
  const textCtx = buildTemplateContext(input.inquiry, input.fromName);
  const assetCtx = buildAssetContext(input.assets, input.mode);
  const merged = { ...textCtx, ...assetCtx };

  const subject = renderTemplate(input.subjectTemplate, merged);
  const html = renderTemplate(input.htmlTemplate, merged);
  const text = htmlToPlainText(html);

  const inlineImages: InlineEmailImage[] =
    input.mode === 'send'
      ? input.assets.map((a) => ({
          assetKey: a.assetKey,
          contentType: a.contentType,
          data: a.data,
          cid: `asset_${a.assetKey}@beast-complaints`,
        }))
      : [];

  return { subject, html, text, inlineImages };
}
