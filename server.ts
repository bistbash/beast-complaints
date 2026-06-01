import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV !== 'production') {
  try {
    dotenv.config({ path: '.env.local' });
  } catch {}
  dotenv.config();
}

const [
  { testConnection, pool },
  { default: authRoutes },
  { default: inquiriesRoutes },
  { default: settingsRoutes },
  { ensureSchema, ensureInquiryWorkflowColumns },
  { loadDatasetMeta },
] = await Promise.all([
  import('./config/db.ts'),
  import('./routes/auth.ts'),
  import('./routes/inquiries.ts'),
  import('./routes/settings.ts'),
  import('./lib/schema.ts'),
  import('./services/datasetMeta.ts'),
]);

const app = express();
const PORT = parseInt(process.env.PORT || '3050', 10);
const datasetId = process.env.COMPLAINTS_DATASET_ID || '';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[req] ${req.method} ${req.url}`);
  }
  next();
});

app.get('/health', async (_req, res) => {
  const db = await testConnection();
  const meta = datasetId ? await loadDatasetMeta(datasetId, pool).catch(() => null) : null;
  res.json({
    status: db.connected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: db.connected ? 'connected' : 'disconnected',
    dataset: meta ? 'configured' : datasetId ? 'missing' : 'unconfigured',
  });
});

app.use('/auth', authRoutes);
app.use('/api/inquiries', inquiriesRoutes);
app.use('/api/settings', settingsRoutes);

const distIndexPath = path.join(__dirname, 'public', 'dist', 'index.html');
if (fs.existsSync(distIndexPath)) {
  const distPath = path.join(__dirname, 'public', 'dist');
  const staticOpts = { maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0, index: false };
  app.use(express.static(distPath, staticOpts));

  app.get('*', (req, res, next) => {
    if (/\.\w{2,10}$/.test(req.path)) return next();
    let html = '';
    try {
      html = fs.readFileSync(distIndexPath, 'utf8');
    } catch {
      res.status(500).send('Missing frontend build');
      return;
    }
    const portalUrl = (process.env.BEAST_PORTAL_URL || 'http://localhost:3000').replace(/\/$/, '');
    const injected = html.replace(
      '</head>',
      `<script>window.__BEAST_PORTAL_URL__=${JSON.stringify(portalUrl)};</script></head>`,
    );
    res.type('html').send(injected);
  });
}

app.use(((err: { status?: number; message?: string }, _req, res, _next) => {
  console.error('[beast-complaints]', err?.message || err);
  res.status(err?.status || 500).json({ error: err?.message || 'Internal server error' });
}) as express.ErrorRequestHandler);

async function startup() {
  try {
    await ensureSchema(pool);
    console.log('[beast-complaints] auxiliary tables ready');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[beast-complaints] failed to ensure schema: ${msg || '(no message — is PostgreSQL reachable at ' + (process.env.DB_HOST || 'localhost') + ':' + (process.env.DB_PORT || '5433') + '?)'}`,
    );
  }

  const meta = datasetId ? await loadDatasetMeta(datasetId, pool).catch(() => null) : null;
  if (datasetId && !meta) {
    console.warn(
      `[beast-complaints] COMPLAINTS_DATASET_ID=${datasetId} לא נמצא ב-db-smart — צור dataset או תקן את ה-ENV.`,
    );
  } else if (!datasetId) {
    console.warn(
      '[beast-complaints] COMPLAINTS_DATASET_ID לא הוגדר. ראה README — צור dataset ב-db-smart ועדכן את .env.',
    );
  } else if (meta) {
    console.log(`[beast-complaints] dataset ready: ${meta.tableName}`);
    try {
      await ensureInquiryWorkflowColumns(pool, meta.tableName);
      console.log('[beast-complaints] workflow columns ensured on dataset table');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[beast-complaints] failed to ensure workflow columns: ${msg}`);
    }
  }
}

const server = app.listen(PORT, () => {
  console.log(`[beast-complaints] http://localhost:${PORT}`);
  void startup();
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[beast-complaints] Port ${PORT} is already in use. Set a free port in .env.local:\n  PORT=3051 npm run dev`,
    );
  } else {
    console.error('[beast-complaints] Server error:', err.message);
  }
  process.exit(1);
});
