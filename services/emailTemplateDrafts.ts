import { pool } from '../config/db.ts';
import type { EmailTemplateKind } from '../lib/emailTemplate.ts';

export interface EmailTemplateDraftDto {
  id: string;
  kind: EmailTemplateKind;
  name: string;
  subjectTemplate: string;
  htmlTemplate: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface DraftRow {
  id: string;
  kind: string;
  name: string;
  subject_template: string;
  html_template: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

const MAX_DRAFTS_PER_KIND = 30;

function rowToDto(row: DraftRow): EmailTemplateDraftDto {
  return {
    id: row.id,
    kind: row.kind as EmailTemplateKind,
    name: row.name,
    subjectTemplate: row.subject_template,
    htmlTemplate: row.html_template,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listEmailTemplateDrafts(
  kind?: EmailTemplateKind,
): Promise<EmailTemplateDraftDto[]> {
  const { rows } = kind
    ? await pool.query<DraftRow>(
        `SELECT * FROM complaints_email_template_drafts WHERE kind = $1 ORDER BY updated_at DESC`,
        [kind],
      )
    : await pool.query<DraftRow>(
        `SELECT * FROM complaints_email_template_drafts ORDER BY kind, updated_at DESC`,
      );
  return rows.map(rowToDto);
}

export async function getEmailTemplateDraft(id: string): Promise<EmailTemplateDraftDto | null> {
  const { rows } = await pool.query<DraftRow>(
    `SELECT * FROM complaints_email_template_drafts WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToDto(rows[0]) : null;
}

export async function createEmailTemplateDraft(
  input: {
    kind: EmailTemplateKind;
    name: string;
    subjectTemplate: string;
    htmlTemplate: string;
  },
  updatedBy: string,
): Promise<EmailTemplateDraftDto> {
  const name = input.name.trim();
  const subjectTemplate = input.subjectTemplate.trim();
  const htmlTemplate = input.htmlTemplate.trim();
  if (!name) throw new Error('draft_name_required');
  if (!subjectTemplate) throw new Error('subject_template_required');
  if (!htmlTemplate) throw new Error('html_template_required');

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM complaints_email_template_drafts WHERE kind = $1`,
    [input.kind],
  );
  if (Number(countRows[0]?.count ?? 0) >= MAX_DRAFTS_PER_KIND) {
    throw new Error('too_many_drafts');
  }

  const { rows } = await pool.query<DraftRow>(
    `INSERT INTO complaints_email_template_drafts
       (kind, name, subject_template, html_template, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.kind, name, subjectTemplate, htmlTemplate, updatedBy],
  );
  return rowToDto(rows[0]!);
}

export async function updateEmailTemplateDraft(
  id: string,
  input: { name?: string; subjectTemplate?: string; htmlTemplate?: string },
  updatedBy: string,
): Promise<EmailTemplateDraftDto | null> {
  const existing = await getEmailTemplateDraft(id);
  if (!existing) return null;

  const name = (input.name ?? existing.name).trim();
  const subjectTemplate = (input.subjectTemplate ?? existing.subjectTemplate).trim();
  const htmlTemplate = (input.htmlTemplate ?? existing.htmlTemplate).trim();
  if (!name) throw new Error('draft_name_required');
  if (!subjectTemplate) throw new Error('subject_template_required');
  if (!htmlTemplate) throw new Error('html_template_required');

  const { rows } = await pool.query<DraftRow>(
    `UPDATE complaints_email_template_drafts
        SET name = $2, subject_template = $3, html_template = $4, updated_by = $5, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, name, subjectTemplate, htmlTemplate, updatedBy],
  );
  return rows[0] ? rowToDto(rows[0]) : null;
}

export async function deleteEmailTemplateDraft(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM complaints_email_template_drafts WHERE id = $1`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}
