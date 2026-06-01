/** Mirrors server variables — grouped for the template studio UI. */

export const EMAIL_TEMPLATE_VARIABLES = [
  { key: 'submitter_name', label: 'שם הפונה' },
  { key: 'submitter_email', label: 'אימייל הפונה' },
  { key: 'submitter_phone', label: 'טלפון הפונה' },
  { key: 'submitter_relation', label: 'קשר הפונה' },
  { key: 'subject', label: 'נושא הפנייה' },
  { key: 'description', label: 'תיאור הפנייה' },
  { key: 'category', label: 'קטגוריה' },
  { key: 'justification_label', label: 'החלטה' },
  { key: 'manager_response', label: 'התייחסות מנהל' },
  { key: 'team_response', label: 'התייחסות צוות' },
  { key: 'closed_at', label: 'תאריך סגירה' },
  { key: 'form_timestamp', label: 'תאריך הגשה' },
  { key: 'grade_level', label: 'שכבה' },
  { key: 'class_name', label: 'כיתה' },
  { key: 'department', label: 'מחלקה' },
  { key: 'assigned_group', label: 'קבוצה משויכת' },
  { key: 'from_name', label: 'שם השולח' },
] as const;

export const EMAIL_VARIABLE_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: 'פונה',
    keys: ['submitter_name', 'submitter_email', 'submitter_phone', 'submitter_relation'],
  },
  {
    title: 'פנייה',
    keys: ['subject', 'description', 'category', 'form_timestamp', 'grade_level', 'class_name', 'department'],
  },
  {
    title: 'טיפול וסגירה',
    keys: [
      'justification_label',
      'manager_response',
      'team_response',
      'closed_at',
      'assigned_group',
      'from_name',
    ],
  },
];

const labelByKey = Object.fromEntries(EMAIL_TEMPLATE_VARIABLES.map((v) => [v.key, v.label]));

export function variableLabel(key: string): string {
  return labelByKey[key] ?? key;
}
