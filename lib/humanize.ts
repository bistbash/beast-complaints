/**
 * Turn an email / username into a readable fallback name, used when the Beast
 * directory can't resolve a real display name (e.g. BEAST_API_KEY is missing or
 * the user isn't in AD). Never returns an English placeholder.
 *
 *   "ilan.brand@beast.org" → "Ilan Brand"
 *   "dana_levi"            → "Dana Levi"
 *   "שירה@local"          → "שירה"
 */
export function humanizeIdentifier(identifier: string | null | undefined): string {
  const raw = String(identifier ?? '').trim();
  if (!raw) return 'משתמש';
  const local = raw.split('@')[0];
  const words = local.split(/[._+\-]+/).filter(Boolean);
  if (!words.length) return raw;
  return words
    .map((w) => (/^[a-z]/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
