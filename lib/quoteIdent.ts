/**
 * Safely quote a PostgreSQL identifier (table/column name).
 * Doubles internal double-quotes per the SQL spec.
 */
export function quoteIdent(name: string): string {
  if (typeof name !== 'string' || !name.length) {
    throw new Error('quoteIdent: empty identifier');
  }
  return `"${name.replace(/"/g, '""')}"`;
}
