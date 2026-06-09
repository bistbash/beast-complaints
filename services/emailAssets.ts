import { pool } from '../config/db.ts';

const MAX_BYTES = 512 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

export interface EmailAssetMeta {
  assetKey: string;
  label: string;
  contentType: string;
  byteSize: number;
  updatedBy: string;
  updatedAt: string;
}

export interface EmailAssetBinary extends EmailAssetMeta {
  data: Buffer;
}

interface AssetRow {
  asset_key: string;
  label: string;
  content_type: string;
  file_data: Buffer;
  updated_by: string;
  updated_at: Date;
}

export function normalizeAssetKey(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) return null;
  return key;
}

export function assetVariableName(assetKey: string): string {
  return `asset_${assetKey}`;
}

export function cidForAsset(assetKey: string): string {
  return `asset_${assetKey}@beast-complaints`;
}

export function assetSrcForMode(assetKey: string, mode: 'preview' | 'send', data: Buffer, contentType: string): string {
  if (mode === 'send') {
    return `cid:${cidForAsset(assetKey)}`;
  }
  return `data:${contentType};base64,${data.toString('base64')}`;
}

export async function listEmailAssets(): Promise<EmailAssetMeta[]> {
  const { rows } = await pool.query<AssetRow>(
    `SELECT asset_key, label, content_type, file_data, updated_by, updated_at
       FROM complaints_email_assets
      ORDER BY asset_key`,
  );
  return rows.map((r) => ({
    assetKey: r.asset_key,
    label: r.label,
    contentType: r.content_type,
    byteSize: r.file_data.length,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function getEmailAssetBinary(assetKey: string): Promise<EmailAssetBinary | null> {
  const { rows } = await pool.query<AssetRow>(
    `SELECT asset_key, label, content_type, file_data, updated_by, updated_at
       FROM complaints_email_assets WHERE asset_key = $1`,
    [assetKey],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    assetKey: r.asset_key,
    label: r.label,
    contentType: r.content_type,
    byteSize: r.file_data.length,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at.toISOString(),
    data: r.file_data,
  };
}

export async function listEmailAssetsBinary(): Promise<EmailAssetBinary[]> {
  const { rows } = await pool.query<AssetRow>(
    `SELECT asset_key, label, content_type, file_data, updated_by, updated_at
       FROM complaints_email_assets ORDER BY asset_key`,
  );
  return rows.map((r) => ({
    assetKey: r.asset_key,
    label: r.label,
    contentType: r.content_type,
    byteSize: r.file_data.length,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at.toISOString(),
    data: r.file_data,
  }));
}

export function buildAssetContext(
  assets: EmailAssetBinary[],
  mode: 'preview' | 'send',
): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const a of assets) {
    ctx[assetVariableName(a.assetKey)] = assetSrcForMode(a.assetKey, mode, a.data, a.contentType);
  }
  return ctx;
}

export async function saveEmailAsset(input: {
  assetKey: string;
  label: string;
  contentType: string;
  data: Buffer;
  updatedBy: string;
}): Promise<EmailAssetMeta> {
  if (!ALLOWED_TYPES.has(input.contentType.toLowerCase())) {
    throw new Error('invalid_content_type');
  }
  if (input.data.length > MAX_BYTES) {
    throw new Error('file_too_large');
  }
  if (!input.label.trim()) {
    throw new Error('label_required');
  }

  await pool.query(
    `INSERT INTO complaints_email_assets (asset_key, label, content_type, file_data, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (asset_key) DO UPDATE SET
       label = EXCLUDED.label,
       content_type = EXCLUDED.content_type,
       file_data = EXCLUDED.file_data,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [input.assetKey, input.label.trim(), input.contentType, input.data, input.updatedBy],
  );

  const meta = (await listEmailAssets()).find((a) => a.assetKey === input.assetKey);
  if (!meta) throw new Error('save_failed');
  return meta;
}

export async function deleteEmailAsset(assetKey: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM complaints_email_assets WHERE asset_key = $1`,
    [assetKey],
  );
  return (rowCount ?? 0) > 0;
}
