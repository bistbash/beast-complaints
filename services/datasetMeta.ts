import { pool } from '../config/db.ts';
import type { Pool } from 'pg';
import type { DatasetMeta } from '../lib/types.ts';

/**
 * Load db-smart dataset metadata (table name, PK, columns).
 * Returns null if the dataset is missing — the caller must surface a helpful
 * setup message instead of crashing.
 */
export async function loadDatasetMeta(
  datasetId: string,
  queryPool: Pool = pool,
): Promise<DatasetMeta | null> {
  if (!datasetId) return null;
  const datasetRes = await queryPool.query<{
    id: string;
    created_by: string | null;
    table_name: string;
    pk_columns: string[];
  }>(
    `SELECT id, created_by, table_name, pk_columns
       FROM datasets WHERE id = $1`,
    [datasetId],
  );
  if (datasetRes.rows.length === 0) return null;

  const dataset = datasetRes.rows[0];
  const colsRes = await queryPool.query<{
    column_index: number;
    original_header: string;
    pg_column_name: string;
    pg_type: string;
    nullable: boolean;
  }>(
    `SELECT column_index, original_header, pg_column_name, pg_type, nullable
       FROM dataset_columns WHERE dataset_id = $1 ORDER BY column_index ASC`,
    [datasetId],
  );

  return {
    datasetId: dataset.id,
    tableName: dataset.table_name,
    pkColumns: Array.isArray(dataset.pk_columns) ? dataset.pk_columns : [],
    createdBy: dataset.created_by,
    columns: colsRes.rows.map((r) => ({
      columnIndex: r.column_index,
      originalHeader: r.original_header,
      pgColumnName: r.pg_column_name,
      pgType: r.pg_type,
      nullable: r.nullable,
    })),
  };
}

/** Verify every required column exists in the dataset, return missing list. */
export function findMissingColumns(meta: DatasetMeta, required: string[]): string[] {
  const present = new Set(meta.columns.map((c) => c.pgColumnName));
  return required.filter((c) => !present.has(c));
}
