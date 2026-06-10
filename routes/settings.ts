import { Router } from 'express';
import { authenticateBeastUser, requireAdmin } from '../middleware/auth.ts';
import {
  deleteEmailConfig,
  frontendAppUrl,
  getEmailConfigPublic,
  isEncryptionConfigured,
  isGoogleOAuthConfigured,
  saveEmailConfig,
} from '../services/emailConfig.ts';
import {
  getEmailCredentialsPublic,
  saveEmailCredentials,
} from '../services/emailCredentials.ts';
import {
  createOAuthState,
  exchangeCodeForTokens,
  getAuthorizationUrl,
  gmailOAuthScopesLabel,
  parseOAuthState,
} from '../services/gmailOAuth.ts';
import { sendTestEmail } from '../services/closingEmail.ts';
import {
  getAllEmailTemplates,
  resetEmailTemplate,
  saveEmailTemplate,
} from '../services/emailTemplates.ts';
import {
  createEmailTemplateDraft,
  deleteEmailTemplateDraft,
  listEmailTemplateDrafts,
  updateEmailTemplateDraft,
} from '../services/emailTemplateDrafts.ts';
import {
  deleteEmailAsset,
  getEmailAssetBinary,
  listEmailAssets,
  normalizeAssetKey,
  saveEmailAsset,
  assetVariableName,
} from '../services/emailAssets.ts';
import {
  EMAIL_TEMPLATE_VARIABLES,
  sampleInquiryForPreview,
  type EmailTemplateKind,
} from '../lib/emailTemplate.ts';
import { renderEmailBodies } from '../lib/emailRender.ts';
import { htmlToPdfBuffer } from '../lib/htmlToPdf.ts';
import { closingLetterPdfFilename } from '../lib/closingEmailMessage.ts';
import { resolveEmailFromName, resolveEmailCredentials } from '../services/emailCredentials.ts';
import { listEmailAssetsBinary } from '../services/emailAssets.ts';

const router: Router = Router();

function settingsRedirect(query: Record<string, string>): string {
  const base = frontendAppUrl();
  const params = new URLSearchParams(query);
  return `${base}/settings?${params.toString()}`;
}

router.get('/email/oauth/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    res.redirect(settingsRedirect({ error: String(oauthError) }));
    return;
  }

  if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
    res.redirect(settingsRedirect({ error: 'missing_code' }));
    return;
  }

  const statePayload = await parseOAuthState(state);
  if (!statePayload) {
    res.redirect(settingsRedirect({ error: 'invalid_state' }));
    return;
  }

  if (!(await isEncryptionConfigured())) {
    res.redirect(settingsRedirect({ error: 'encryption_not_configured' }));
    return;
  }

  try {
    const { refreshToken, gmailAddress } = await exchangeCodeForTokens(code);
    await saveEmailConfig({
      gmailAddress,
      refreshToken,
      connectedBy: statePayload.connectedBy,
      scopes: gmailOAuthScopesLabel(),
    });
    res.redirect(settingsRedirect({ connected: '1' }));
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'oauth_failed';
    const msg = /insufficient.*authentication.*scopes/i.test(raw)
      ? 'insufficient_scopes'
      : raw;
    console.warn('[beast-complaints] Gmail OAuth callback failed:', raw);
    res.redirect(settingsRedirect({ error: msg }));
  }
});

router.use(authenticateBeastUser);
router.use(requireAdmin);

router.get('/email', async (_req, res, next) => {
  try {
    const status = await getEmailConfigPublic();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.get('/email/credentials', async (_req, res, next) => {
  try {
    const credentials = await getEmailCredentialsPublic();
    res.json({ credentials });
  } catch (err) {
    next(err);
  }
});

router.put('/email/credentials', async (req, res) => {
  const body = req.body || {};
  const googleClientId = typeof body.googleClientId === 'string' ? body.googleClientId : '';
  const googleClientSecret =
    typeof body.googleClientSecret === 'string' ? body.googleClientSecret : undefined;
  const tokenEncryptionKey =
    typeof body.tokenEncryptionKey === 'string' ? body.tokenEncryptionKey : undefined;
  const oauthRedirectUri =
    body.oauthRedirectUri === null || typeof body.oauthRedirectUri === 'string'
      ? body.oauthRedirectUri
      : undefined;
  const emailFromName =
    body.emailFromName === null || typeof body.emailFromName === 'string' ? body.emailFromName : undefined;

  const updatedBy = req.user?.email || `${req.user?.username || 'admin'}@local`;

  try {
    await saveEmailCredentials({
      googleClientId,
      googleClientSecret,
      tokenEncryptionKey,
      oauthRedirectUri,
      emailFromName,
      updatedBy,
    });
    const credentials = await getEmailCredentialsPublic();
    res.json({ ok: true, credentials });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'save_failed';
    const messages: Record<string, string> = {
      google_client_id_required: 'נדרש Client ID',
      google_client_secret_required: 'נדרש Client Secret',
      token_encryption_key_required: 'נדרש מפתח הצפנה',
      encryption_key_change_requires_disconnect:
        'לא ניתן לשנות מפתח הצפנה כשחשבון Gmail מחובר — נתקו קודם את החשבון',
      email_credentials_not_configured: 'הגדרות חסרות',
    };
    res.status(400).json({ error: messages[msg] || msg });
  }
});

router.get('/email/oauth/start', async (req, res) => {
  if (!(await isGoogleOAuthConfigured())) {
    res.status(503).json({ error: 'הגדרות Google OAuth חסרות — מלאו את הטופס למטה ושמרו' });
    return;
  }
  if (!(await isEncryptionConfigured())) {
    res.status(503).json({ error: 'מפתח הצפנה חסר — מלאו את הטופס למטה ושמרו' });
    return;
  }
  const connectedBy = req.user?.email || `${req.user?.username || 'admin'}@local`;
  const state = await createOAuthState(connectedBy);
  const url = await getAuthorizationUrl(state);
  res.json({ url });
});

router.delete('/email', async (_req, res, next) => {
  try {
    await deleteEmailConfig();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/email/assets', async (_req, res, next) => {
  try {
    const assets = await listEmailAssets();
    res.json({
      assets,
      variables: assets.map((a) => ({
        key: assetVariableName(a.assetKey),
        label: a.label,
        assetKey: a.assetKey,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/email/assets/:key/file', async (req, res, next) => {
  try {
    const key = normalizeAssetKey(req.params.key);
    if (!key) {
      res.status(400).json({ error: 'מפתח לא תקין' });
      return;
    }
    const asset = await getEmailAssetBinary(key);
    if (!asset) {
      res.status(404).json({ error: 'לא נמצא' });
      return;
    }
    res.setHeader('Content-Type', asset.contentType);
    // Admin-only blobs; avoid stale browser cache after replace/delete on same key.
    res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
    res.setHeader('ETag', `"${asset.assetKey}-${asset.updatedAt}"`);
    res.send(asset.data);
  } catch (err) {
    next(err);
  }
});

router.put('/email/assets/:key', async (req, res) => {
  const key = normalizeAssetKey(req.params.key);
  if (!key) {
    res.status(400).json({ error: 'מפתח חייב להתחיל באות באנגלית (למשל logo, signature)' });
    return;
  }
  const label = typeof req.body?.label === 'string' ? req.body.label : '';
  const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : '';
  const dataBase64 = typeof req.body?.dataBase64 === 'string' ? req.body.dataBase64 : '';
  if (!dataBase64) {
    res.status(400).json({ error: 'נדרש קובץ תמונה' });
    return;
  }
  let data: Buffer;
  try {
    data = Buffer.from(dataBase64, 'base64');
  } catch {
    res.status(400).json({ error: 'קובץ לא תקין' });
    return;
  }
  const updatedBy = req.user?.email || `${req.user?.username || 'admin'}@local`;
  try {
    const asset = await saveEmailAsset({
      assetKey: key,
      label: label || key,
      contentType,
      data,
      updatedBy,
    });
    res.json({ ok: true, asset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'save_failed';
    const messages: Record<string, string> = {
      invalid_content_type: 'סוג קובץ לא נתמך (PNG, JPEG, GIF, WebP)',
      file_too_large: 'הקובץ גדול מדי (מקסימום 512KB)',
      label_required: 'נדרש שם לנכס',
    };
    res.status(400).json({ error: messages[msg] || msg });
  }
});

router.delete('/email/assets/:key', async (req, res, next) => {
  try {
    const key = normalizeAssetKey(req.params.key);
    if (!key) {
      res.status(400).json({ error: 'מפתח לא תקין' });
      return;
    }
    const removed = await deleteEmailAsset(key);
    if (!removed) {
      res.status(404).json({ error: 'לא נמצא' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/email/templates', async (_req, res, next) => {
  try {
    const [templates, assets, drafts] = await Promise.all([
      getAllEmailTemplates(),
      listEmailAssets(),
      listEmailTemplateDrafts(),
    ]);
    res.json({
      variables: EMAIL_TEMPLATE_VARIABLES,
      assetVariables: assets.map((a) => ({
        key: assetVariableName(a.assetKey),
        label: a.label,
        assetKey: a.assetKey,
      })),
      templates,
      drafts,
    });
  } catch (err) {
    next(err);
  }
});

const DRAFT_ERROR_MESSAGES: Record<string, string> = {
  draft_name_required: 'נדרש שם לטיוטה',
  subject_template_required: 'נושא המייל חסר',
  html_template_required: 'תבנית HTML חסרה',
  too_many_drafts: 'הגעתם למספר המרבי של טיוטות לסוג זה',
};

router.get('/email/templates/drafts', async (_req, res, next) => {
  try {
    res.json({ drafts: await listEmailTemplateDrafts() });
  } catch (err) {
    next(err);
  }
});

router.post('/email/templates/drafts', async (req, res) => {
  const kind = req.body?.kind === 'unjustified' ? 'unjustified' : 'justified';
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  const subjectTemplate = typeof req.body?.subjectTemplate === 'string' ? req.body.subjectTemplate : '';
  const htmlTemplate = typeof req.body?.htmlTemplate === 'string' ? req.body.htmlTemplate : '';
  const updatedBy = req.user?.email || `${req.user?.username || 'admin'}@local`;
  try {
    const draft = await createEmailTemplateDraft(
      { kind, name, subjectTemplate, htmlTemplate },
      updatedBy,
    );
    res.json({ ok: true, draft });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'save_failed';
    res.status(400).json({ error: DRAFT_ERROR_MESSAGES[msg] || msg });
  }
});

router.put('/email/templates/drafts/:id', async (req, res) => {
  const id = req.params.id;
  const updatedBy = req.user?.email || `${req.user?.username || 'admin'}@local`;
  const patch: { name?: string; subjectTemplate?: string; htmlTemplate?: string } = {};
  if (typeof req.body?.name === 'string') patch.name = req.body.name;
  if (typeof req.body?.subjectTemplate === 'string') patch.subjectTemplate = req.body.subjectTemplate;
  if (typeof req.body?.htmlTemplate === 'string') patch.htmlTemplate = req.body.htmlTemplate;
  try {
    const draft = await updateEmailTemplateDraft(id, patch, updatedBy);
    if (!draft) {
      res.status(404).json({ error: 'הטיוטה לא נמצאה' });
      return;
    }
    res.json({ ok: true, draft });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'save_failed';
    res.status(400).json({ error: DRAFT_ERROR_MESSAGES[msg] || msg });
  }
});

router.delete('/email/templates/drafts/:id', async (req, res, next) => {
  try {
    const removed = await deleteEmailTemplateDraft(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'הטיוטה לא נמצאה' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put('/email/templates/:kind', async (req, res) => {
  const kind = req.params.kind;
  if (kind !== 'justified' && kind !== 'unjustified') {
    res.status(400).json({ error: 'סוג תבנית לא תקין' });
    return;
  }
  const subjectTemplate = typeof req.body?.subjectTemplate === 'string' ? req.body.subjectTemplate : '';
  const htmlTemplate = typeof req.body?.htmlTemplate === 'string' ? req.body.htmlTemplate : '';
  const updatedBy = req.user?.email || `${req.user?.username || 'admin'}@local`;
  try {
    const template = await saveEmailTemplate(kind, { subjectTemplate, htmlTemplate }, updatedBy);
    res.json({ ok: true, template });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'save_failed';
    const messages: Record<string, string> = {
      subject_template_required: 'נושא המייל חסר',
      html_template_required: 'תבנית HTML חסרה',
    };
    res.status(400).json({ error: messages[msg] || msg });
  }
});

router.delete('/email/templates/:kind', async (req, res, next) => {
  const kind = req.params.kind;
  if (kind !== 'justified' && kind !== 'unjustified') {
    res.status(400).json({ error: 'סוג תבנית לא תקין' });
    return;
  }
  try {
    const template = await resetEmailTemplate(kind);
    res.json({ ok: true, template });
  } catch (err) {
    next(err);
  }
});

async function renderTemplatePreviewBodies(
  kind: EmailTemplateKind,
  subjectTemplate: string | undefined,
  htmlTemplate: string | undefined,
) {
  const templates = await getAllEmailTemplates();
  const subject =
    typeof subjectTemplate === 'string' ? subjectTemplate : templates[kind].subjectTemplate;
  const html =
    typeof htmlTemplate === 'string' ? htmlTemplate : templates[kind].htmlTemplate;

  const creds = await resolveEmailCredentials();
  const fromName = resolveEmailFromName(creds);
  const inquiry = sampleInquiryForPreview(kind);
  const assets = await listEmailAssetsBinary();
  const rendered = renderEmailBodies({
    subjectTemplate: subject,
    htmlTemplate: html,
    inquiry,
    fromName,
    assets,
    mode: 'preview',
  });

  return { rendered, inquiry };
}

router.post('/email/templates/preview', async (req, res, next) => {
  try {
    const kind: EmailTemplateKind =
      req.body?.kind === 'unjustified' ? 'unjustified' : 'justified';
    const { rendered } = await renderTemplatePreviewBodies(
      kind,
      req.body?.subjectTemplate,
      req.body?.htmlTemplate,
    );

    res.json({
      subject: rendered.subject,
      html: rendered.html,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/email/templates/preview-pdf', async (req, res, next) => {
  try {
    const kind: EmailTemplateKind =
      req.body?.kind === 'unjustified' ? 'unjustified' : 'justified';
    const { rendered, inquiry } = await renderTemplatePreviewBodies(
      kind,
      req.body?.subjectTemplate,
      req.body?.htmlTemplate,
    );

    let pdf: Buffer;
    try {
      pdf = await htmlToPdfBuffer(rendered.html);
    } catch (err) {
      console.warn(
        '[beast-complaints] template preview PDF failed:',
        err instanceof Error ? err.message : err,
      );
      res.status(503).json({
        error: 'יצירת PDF נכשלה — Chromium לא זמין בשרת (הגדירו PUPPETEER_EXECUTABLE_PATH)',
      });
      return;
    }
    const filename = closingLetterPdfFilename(inquiry);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

router.post('/email/test', async (req, res) => {
  const to = (req.body?.to as string | undefined)?.trim() || req.user?.email;
  if (!to) {
    res.status(400).json({ error: 'נדרשת כתובת נמען לבדיקה' });
    return;
  }
  const result = await sendTestEmail(to);
  if (result.ok) {
    res.json({ ok: true });
    return;
  }
  const messages: Record<string, string> = {
    not_configured: 'חשבון Gmail לא מחובר',
    encryption_not_configured: 'מפתח הצפנה לא מוגדר',
    send_failed: 'שליחת המייל נכשלה — בדקו את ההרשאות ב-Google',
  };
  res.status(400).json({ error: messages[result.reason] || result.reason });
});

export default router;
