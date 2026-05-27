import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME || 'db_smart',
  user: process.env.DB_USER || 'db_smart',
  password: process.env.DB_PASSWORD || 'changeme_db_smart_password',
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function testConnection(): Promise<{ connected: boolean; now?: string; error?: string }> {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query<{ now: string }>('SELECT NOW() as now');
      return { connected: true, now: result.rows[0].now };
    } finally {
      client.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { connected: false, error: message };
  }
}
