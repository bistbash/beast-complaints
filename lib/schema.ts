import type { Pool } from 'pg';
import { quoteIdent } from './quoteIdent.ts';

/**
 * Auxiliary tables that complement the db-smart inquiry dataset.
 * The dataset itself is created via the db-smart UI; these tables hold
 * message threads, audit history, and lightweight notification deliveries
 * that don't fit the single-row-per-record model db-smart enforces.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS complaints_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id    UUID NOT NULL,
  author        TEXT NOT NULL,
  author_name   TEXT,
  content       TEXT NOT NULL,
  message_type  TEXT NOT NULL DEFAULT 'comment',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS complaints_messages_inquiry_idx
  ON complaints_messages (inquiry_id, created_at);

CREATE TABLE IF NOT EXISTS complaints_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id  UUID NOT NULL,
  action      TEXT NOT NULL,
  actor       TEXT NOT NULL,
  actor_name  TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS complaints_history_inquiry_idx
  ON complaints_history (inquiry_id, created_at);

CREATE TABLE IF NOT EXISTS complaints_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id  UUID NOT NULL,
  recipient   TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'beast',
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS complaints_notifications_recipient_idx
  ON complaints_notifications (recipient, created_at);

CREATE TABLE IF NOT EXISTS complaints_email_credentials (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  google_client_id      TEXT NOT NULL,
  google_client_secret  TEXT NOT NULL,
  token_encryption_key  TEXT NOT NULL,
  oauth_redirect_uri    TEXT,
  email_from_name       TEXT,
  updated_by            TEXT NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaints_email_assets (
  asset_key    TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_data    BYTEA NOT NULL,
  updated_by   TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaints_email_templates (
  justification    TEXT PRIMARY KEY CHECK (justification IN ('justified', 'unjustified')),
  subject_template TEXT NOT NULL,
  html_template    TEXT NOT NULL,
  updated_by       TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaints_email_template_drafts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL CHECK (kind IN ('justified', 'unjustified')),
  name             TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  html_template    TEXT NOT NULL,
  updated_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS complaints_email_template_drafts_kind_idx
  ON complaints_email_template_drafts (kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS complaints_email_config (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  gmail_address     TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  scopes            TEXT NOT NULL DEFAULT 'gmail.send',
  connected_by      TEXT NOT NULL,
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  await pool.query(SCHEMA_SQL);
}

/**
 * Adds workflow columns to the dataset table managed by db-smart.
 *
 * The Google Sheets sync only touches the 14 "sheet" columns (timestamp, email,
 * full_name, etc.) — anything we add here will survive every sync.
 *
 * Safe to run repeatedly: all ADDs use IF NOT EXISTS and the backfill only
 * touches rows where the value is still NULL.
 */
export async function ensureInquiryWorkflowColumns(pool: Pool, tableName: string): Promise<void> {
  const t = quoteIdent(tableName);

  // Add workflow columns with DEFAULTs — rows synced from Google Sheets later
  // will auto-populate these values without us needing to touch them.
  await pool.query(`
    ALTER TABLE ${t}
      ADD COLUMN IF NOT EXISTS inquiry_id            uuid        DEFAULT gen_random_uuid(),
      ADD COLUMN IF NOT EXISTS status                text        DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS priority              text        DEFAULT 'medium',
      ADD COLUMN IF NOT EXISTS created_at            timestamptz DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS routed_at             timestamptz,
      ADD COLUMN IF NOT EXISTS routed_by             text,
      ADD COLUMN IF NOT EXISTS assigned_group        text,
      ADD COLUMN IF NOT EXISTS assigned_user         text,
      ADD COLUMN IF NOT EXISTS team_response         text,
      ADD COLUMN IF NOT EXISTS team_response_at      timestamptz,
      ADD COLUMN IF NOT EXISTS team_response_by      text,
      ADD COLUMN IF NOT EXISTS manager_response      text,
      ADD COLUMN IF NOT EXISTS manager_response_at   timestamptz,
      ADD COLUMN IF NOT EXISTS manager_response_by   text,
      ADD COLUMN IF NOT EXISTS justification         text,
      ADD COLUMN IF NOT EXISTS justification_at      timestamptz,
      ADD COLUMN IF NOT EXISTS justification_by      text,
      ADD COLUMN IF NOT EXISTS closed_at             timestamptz,
      ADD COLUMN IF NOT EXISTS last_activity_at      timestamptz DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS due_at                timestamptz DEFAULT (NOW() + INTERVAL '72 hours'),
      ADD COLUMN IF NOT EXISTS closing_email_sent_at timestamptz,
      ADD COLUMN IF NOT EXISTS legacy_id             text
  `);

  // Defensive backfill (Postgres should fill DEFAULTs on ADD COLUMN, but just in case):
  await pool.query(`
    UPDATE ${t}
       SET inquiry_id       = COALESCE(inquiry_id, gen_random_uuid()),
           status           = COALESCE(status, 'new'),
           priority         = COALESCE(priority, 'medium'),
           last_activity_at = COALESCE(last_activity_at, NOW())
     WHERE inquiry_id IS NULL OR status IS NULL OR priority IS NULL OR last_activity_at IS NULL
  `);

  // Re-derive created_at from the Google Form "timestamp" text for rows that
  // currently look like they were filled by ADD COLUMN DEFAULT NOW() (i.e. their
  // "created_at" is suspiciously close to "last_activity_at" and the sheet has a
  // parseable date). One-shot — only touches rows where the form timestamp is
  // BEFORE the workflow created_at (proving we're seeing a sync-backfilled row).
  await pool.query(`
    UPDATE ${t}
       SET created_at = to_timestamp("timestamp", 'DD/MM/YYYY HH24:MI:SS')
     WHERE "timestamp" ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4} [0-9]{1,2}:[0-9]{2}:[0-9]{2}$'
       AND to_timestamp("timestamp", 'DD/MM/YYYY HH24:MI:SS') < created_at - INTERVAL '1 minute'
  `);

  // Make sure the UUID is unique so it can be used as a foreign key.
  const safeBase = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
  const constraintName = `${safeBase}_inquiry_id_key`.slice(0, 63);
  const exists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS exists`,
    [constraintName],
  );
  if (!exists.rows[0]?.exists) {
    await pool.query(`ALTER TABLE ${t} ADD CONSTRAINT ${quoteIdent(constraintName)} UNIQUE (inquiry_id)`);
  }

  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${safeBase}_status_idx`.slice(0, 63))}
       ON ${t} (status, last_activity_at DESC)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${safeBase}_assigned_idx`.slice(0, 63))}
       ON ${t} (assigned_group, assigned_user)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${safeBase}_legacy_idx`.slice(0, 63))}
       ON ${t} (legacy_id)`,
  );
}
