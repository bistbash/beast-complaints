import { useCallback, useEffect, useState } from 'react';
import api from '../utils/api.ts';

export type TemplateKind = 'justified' | 'unjustified';

export interface EmailCredentialsPublic {
  configured: boolean;
  googleClientId: string | null;
  hasClientSecret: boolean;
  hasEncryptionKey: boolean;
  oauthRedirectUri: string | null;
  suggestedRedirectUri: string;
  emailFromName: string | null;
}

export interface EmailStatus {
  connected: boolean;
  gmailAddress: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  googleConfigured: boolean;
  encryptionConfigured: boolean;
  credentials: EmailCredentialsPublic;
}

export interface TemplateDto {
  subjectTemplate: string;
  htmlTemplate: string;
  isCustom: boolean;
}

export interface AssetMeta {
  assetKey: string;
  label: string;
  contentType: string;
  byteSize: number;
  updatedAt: string;
}

export interface AssetVariable {
  key: string;
  label: string;
  assetKey: string;
}

export interface TemplateDraft {
  id: string;
  kind: TemplateKind;
  name: string;
  subjectTemplate: string;
  htmlTemplate: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialsPayload {
  googleClientId: string;
  googleClientSecret?: string;
  tokenEncryptionKey?: string;
  oauthRedirectUri: string | null;
  emailFromName: string | null;
}

export interface Result<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
}

function err(data: unknown, fallback: string): string {
  return (data as { error?: string } | null)?.error || fallback;
}

/**
 * Single source of truth for the admin settings screen: connection status,
 * closing-letter templates and graphic assets, plus every mutation against the
 * `/api/settings/email` surface. Components stay presentational.
 */
export function useEmailSettings() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [templates, setTemplates] = useState<Record<TemplateKind, TemplateDto> | null>(null);
  const [drafts, setDrafts] = useState<TemplateDraft[]>([]);
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [assetVariables, setAssetVariables] = useState<AssetVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await api.get<EmailStatus>('/api/settings/email');
    if (res.status < 400 && res.data) {
      setStatus(res.data);
      return true;
    }
    return false;
  }, []);

  const loadTemplates = useCallback(async () => {
    const res = await api.get<{
      templates: Record<TemplateKind, TemplateDto>;
      assetVariables?: AssetVariable[];
      drafts?: TemplateDraft[];
    }>('/api/settings/email/templates');
    if (res.status < 400 && res.data?.templates) {
      setTemplates(res.data.templates);
      if (res.data.assetVariables) setAssetVariables(res.data.assetVariables);
      if (res.data.drafts) setDrafts(res.data.drafts);
    }
  }, []);

  const loadDrafts = useCallback(async () => {
    const res = await api.get<{ drafts: TemplateDraft[] }>('/api/settings/email/templates/drafts');
    if (res.status < 400 && res.data?.drafts) setDrafts(res.data.drafts);
  }, []);

  const loadAssets = useCallback(async () => {
    const res = await api.get<{ assets: AssetMeta[]; variables: AssetVariable[] }>(
      '/api/settings/email/assets',
    );
    if (res.status < 400 && res.data) {
      setAssets(res.data.assets);
      setAssetVariables(res.data.variables);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const ok = await loadStatus();
      await Promise.all([loadTemplates(), loadAssets()]);
      setFailed(!ok);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [loadStatus, loadTemplates, loadAssets]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* ---- connection / credentials ---- */

  const saveCredentials = useCallback(
    async (payload: CredentialsPayload): Promise<Result> => {
      const res = await api.put('/api/settings/email/credentials', payload);
      if (res.status >= 400) return { ok: false, error: err(res.data, 'שמירה נכשלה') };
      await loadStatus();
      return { ok: true };
    },
    [loadStatus],
  );

  const startOAuth = useCallback(async (): Promise<Result<string>> => {
    const res = await api.get<{ url?: string; error?: string }>('/api/settings/email/oauth/start');
    if (res.status >= 400 || !res.data?.url) {
      return { ok: false, error: res.data?.error || 'לא ניתן להתחיל חיבור' };
    }
    return { ok: true, data: res.data.url };
  }, []);

  const disconnect = useCallback(async (): Promise<Result> => {
    const res = await api.delete('/api/settings/email');
    if (res.status >= 400) return { ok: false, error: 'ניתוק נכשל' };
    await loadStatus();
    return { ok: true };
  }, [loadStatus]);

  const sendTest = useCallback(async (): Promise<Result> => {
    const res = await api.post('/api/settings/email/test', {});
    if (res.status >= 400) return { ok: false, error: err(res.data, 'שליחה נכשלה') };
    return { ok: true };
  }, []);

  /* ---- templates ---- */

  const saveTemplate = useCallback(
    async (kind: TemplateKind, subjectTemplate: string, htmlTemplate: string): Promise<Result> => {
      const res = await api.put(`/api/settings/email/templates/${kind}`, {
        subjectTemplate,
        htmlTemplate,
      });
      if (res.status >= 400) return { ok: false, error: err(res.data, 'שמירה נכשלה') };
      await loadTemplates();
      return { ok: true };
    },
    [loadTemplates],
  );

  const resetTemplate = useCallback(
    async (kind: TemplateKind): Promise<Result> => {
      const res = await api.delete(`/api/settings/email/templates/${kind}`);
      if (res.status >= 400) return { ok: false, error: 'איפוס נכשל' };
      await loadTemplates();
      return { ok: true };
    },
    [loadTemplates],
  );

  const createDraft = useCallback(
    async (input: {
      kind: TemplateKind;
      name: string;
      subjectTemplate: string;
      htmlTemplate: string;
    }): Promise<Result<TemplateDraft>> => {
      const res = await api.post<{ draft: TemplateDraft; error?: string }>(
        '/api/settings/email/templates/drafts',
        input,
      );
      if (res.status >= 400 || !res.data?.draft) {
        return { ok: false, error: err(res.data, 'שמירת הטיוטה נכשלה') };
      }
      await loadDrafts();
      return { ok: true, data: res.data.draft };
    },
    [loadDrafts],
  );

  const updateDraft = useCallback(
    async (
      id: string,
      patch: { name?: string; subjectTemplate?: string; htmlTemplate?: string },
    ): Promise<Result<TemplateDraft>> => {
      const res = await api.put<{ draft: TemplateDraft; error?: string }>(
        `/api/settings/email/templates/drafts/${id}`,
        patch,
      );
      if (res.status >= 400 || !res.data?.draft) {
        return { ok: false, error: err(res.data, 'עדכון הטיוטה נכשל') };
      }
      await loadDrafts();
      return { ok: true, data: res.data.draft };
    },
    [loadDrafts],
  );

  const deleteDraft = useCallback(
    async (id: string): Promise<Result> => {
      const res = await api.delete(`/api/settings/email/templates/drafts/${id}`);
      if (res.status >= 400) return { ok: false, error: err(res.data, 'מחיקת הטיוטה נכשלה') };
      await loadDrafts();
      return { ok: true };
    },
    [loadDrafts],
  );

  const previewTemplate = useCallback(
    async (
      kind: TemplateKind,
      subjectTemplate: string,
      htmlTemplate: string,
    ): Promise<Result<{ subject: string; html: string }>> => {
      const res = await api.post<{ subject: string; html: string }>(
        '/api/settings/email/templates/preview',
        { kind, subjectTemplate, htmlTemplate },
      );
      if (res.status >= 400 || !res.data) return { ok: false };
      return { ok: true, data: res.data };
    },
    [],
  );

  const previewTemplatePdf = useCallback(
    async (
      kind: TemplateKind,
      subjectTemplate: string,
      htmlTemplate: string,
    ): Promise<Result<Blob>> => {
      try {
        const res = await api.post<Blob>(
          '/api/settings/email/templates/preview-pdf',
          { kind, subjectTemplate, htmlTemplate },
          { responseType: 'blob', timeout: 120_000 },
        );
        if (res.status >= 400 || !(res.data instanceof Blob)) {
          try {
            const text = await (res.data as Blob).text();
            const parsed = JSON.parse(text) as { error?: string };
            return { ok: false, error: parsed.error || 'יצירת PDF נכשלה' };
          } catch {
            return { ok: false, error: 'יצירת PDF נכשלה' };
          }
        }
        if (res.data.type && res.data.type !== 'application/pdf') {
          try {
            const text = await res.data.text();
            const parsed = JSON.parse(text) as { error?: string };
            return { ok: false, error: parsed.error || 'יצירת PDF נכשלה' };
          } catch {
            return { ok: false, error: 'יצירת PDF נכשלה' };
          }
        }
        return { ok: true, data: res.data };
      } catch {
        return { ok: false, error: 'יצירת PDF נכשלה — בדקו שהשרת זמין ו-Chromium מותקן' };
      }
    },
    [],
  );

  /* ---- assets ---- */

  const uploadAsset = useCallback(
    async (input: {
      key: string;
      label: string;
      contentType: string;
      dataBase64: string;
    }): Promise<Result> => {
      const res = await api.put(`/api/settings/email/assets/${input.key}`, {
        label: input.label,
        contentType: input.contentType,
        dataBase64: input.dataBase64,
      });
      if (res.status >= 400) return { ok: false, error: err(res.data, 'העלאה נכשלה') };
      await loadAssets();
      return { ok: true };
    },
    [loadAssets],
  );

  const deleteAsset = useCallback(
    async (assetKey: string): Promise<Result> => {
      const res = await api.delete(`/api/settings/email/assets/${assetKey}`);
      if (res.status >= 400) return { ok: false, error: 'מחיקה נכשלה' };
      await loadAssets();
      return { ok: true };
    },
    [loadAssets],
  );

  return {
    status,
    templates,
    drafts,
    assets,
    assetVariables,
    loading,
    failed,
    reloadStatus: loadStatus,
    saveCredentials,
    startOAuth,
    disconnect,
    sendTest,
    saveTemplate,
    resetTemplate,
    previewTemplate,
    previewTemplatePdf,
    createDraft,
    updateDraft,
    deleteDraft,
    uploadAsset,
    deleteAsset,
  };
}

export type EmailSettings = ReturnType<typeof useEmailSettings>;
