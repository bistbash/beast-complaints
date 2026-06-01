import { pool } from '../config/db.ts';
import {
  defaultHtmlTemplate,
  defaultSubjectTemplate,
  type EmailTemplateKind,
} from '../lib/emailTemplate.ts';

export interface EmailTemplateDto {
  subjectTemplate: string;
  htmlTemplate: string;
  isCustom: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface TemplateRow {
  justification: string;
  subject_template: string;
  html_template: string;
  updated_by: string;
  updated_at: Date;
}

function rowToDto(row: TemplateRow): EmailTemplateDto {
  return {
    subjectTemplate: row.subject_template,
    htmlTemplate: row.html_template,
    isCustom: true,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}

function defaultDto(kind: EmailTemplateKind): EmailTemplateDto {
  return {
    subjectTemplate: defaultSubjectTemplate(kind),
    htmlTemplate: defaultHtmlTemplate(kind),
    isCustom: false,
    updatedAt: null,
    updatedBy: null,
  };
}

export async function getEmailTemplate(kind: EmailTemplateKind): Promise<EmailTemplateDto> {
  const { rows } = await pool.query<TemplateRow>(
    `SELECT justification, subject_template, html_template, updated_by, updated_at
       FROM complaints_email_templates
      WHERE justification = $1`,
    [kind],
  );
  const row = rows[0];
  return row ? rowToDto(row) : defaultDto(kind);
}

export async function getAllEmailTemplates(): Promise<Record<EmailTemplateKind, EmailTemplateDto>> {
  const [justified, unjustified] = await Promise.all([
    getEmailTemplate('justified'),
    getEmailTemplate('unjustified'),
  ]);
  return { justified, unjustified };
}

export async function saveEmailTemplate(
  kind: EmailTemplateKind,
  input: { subjectTemplate: string; htmlTemplate: string },
  updatedBy: string,
): Promise<EmailTemplateDto> {
  const subjectTemplate = input.subjectTemplate.trim();
  const htmlTemplate = input.htmlTemplate.trim();
  if (!subjectTemplate) throw new Error('subject_template_required');
  if (!htmlTemplate) throw new Error('html_template_required');

  await pool.query(
    `INSERT INTO complaints_email_templates (justification, subject_template, html_template, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (justification) DO UPDATE SET
       subject_template = EXCLUDED.subject_template,
       html_template = EXCLUDED.html_template,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [kind, subjectTemplate, htmlTemplate, updatedBy],
  );
  return getEmailTemplate(kind);
}

export async function resetEmailTemplate(kind: EmailTemplateKind): Promise<EmailTemplateDto> {
  await pool.query(`DELETE FROM complaints_email_templates WHERE justification = $1`, [kind]);
  return defaultDto(kind);
}
