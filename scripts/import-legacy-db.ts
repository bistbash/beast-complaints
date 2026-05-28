/**
 * CLI wrapper for legacy complaints-manager TSV import.
 *
 * Usage:
 *   npm run import-legacy-db -- data/legacy-export.tsv
 *   npm run import-legacy-db -- data/legacy-export.tsv --dry-run
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { pool } from '../config/db.ts';
import { importLegacyTsv } from '../services/legacyImport.ts';

function parseArgs(): { file: string; dryRun: boolean } {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const dryRun = args.includes('--dry-run');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: npm run import-legacy-db -- <file.tsv> [--dry-run]');
    process.exit(1);
  }
  return { file, dryRun };
}

async function main() {
  const { file, dryRun } = parseArgs();
  const raw = await fs.readFile(path.resolve(file), 'utf8');
  console.log(`Importing ${file}${dryRun ? ' (dry-run)' : ''}…`);

  const result = await importLegacyTsv(raw, { dryRun });
  console.log(JSON.stringify(result, null, 2));

  if (result.warnings.length) {
    console.log('\nWarnings:');
    for (const w of result.warnings) console.log(`  ⚠ ${w}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
