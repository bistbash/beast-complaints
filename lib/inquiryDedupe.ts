/**
 * Google Sheets → db-smart sync occasionally creates near-duplicate rows for the
 * same form submission (timestamps differ by one second). Legacy imports match on
 * exact timestamp+email, leaving a stray "new" copy next to the workflow row.
 *
 * When listing inquiries we keep the canonical row per (email, title, description)
 * and prefer the row with legacy workflow data.
 */
/** Collapse whitespace so sync/import copies with minor formatting diffs still match. */
export const INQUIRY_DEDUPE_DESCRIPTION_KEY = `MD5(
  REGEXP_REPLACE(TRIM(COALESCE(description, '')), E'\\\\s+', ' ', 'g')
)`;

export const INQUIRY_DEDUPE_PARTITION = `
  LOWER(TRIM(email)),
  title,
  ${INQUIRY_DEDUPE_DESCRIPTION_KEY}
`;

export const INQUIRY_DEDUPE_ORDER = `
  (legacy_id IS NOT NULL AND TRIM(legacy_id) <> '') DESC,
  CASE status
    WHEN 'closed' THEN 4
    WHEN 'awaiting_manager' THEN 3
    WHEN 'routed' THEN 2
    ELSE 1
  END DESC,
  (assigned_group IS NOT NULL AND TRIM(assigned_group) <> '') DESC,
  last_activity_at DESC NULLS LAST,
  inquiry_id
`;

export function inquiryListOrderSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `
    CASE ${p}status WHEN 'new' THEN 1 WHEN 'routed' THEN 2 WHEN 'awaiting_manager' THEN 3 ELSE 4 END,
    CASE ${p}priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
    ${p}last_activity_at DESC NULLS LAST
  `;
}
