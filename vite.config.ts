import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = process.env.PORT || env.PORT || '3050';
  const backendTarget =
    process.env.VITE_BACKEND_TARGET || env.VITE_BACKEND_TARGET || `http://127.0.0.1:${backendPort}`;
  // BEAST_PORTAL_URL is the source of truth. VITE_PORTAL_URL is an optional override only.
  const beastPortalForClient = (env.BEAST_PORTAL_URL || env.VITE_PORTAL_URL || 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );

  return {
    plugins: [
      react(),
      {
        name: 'inject-beast-portal-url',
        transformIndexHtml(html: string) {
          const script = `<script>window.__BEAST_PORTAL_URL__=${JSON.stringify(beastPortalForClient)};</script>`;
          return html.replace('</head>', `${script}</head>`);
        },
      },
    ],
    define: {
      'import.meta.env.VITE_PORTAL_URL': JSON.stringify(beastPortalForClient),
    },
    build: {
      outDir: 'public/dist',
      emptyOutDir: true,
    },
    server: {
      port: 5180,
      proxy: {
        '/api': { target: backendTarget, changeOrigin: true },
        '/auth': { target: backendTarget, changeOrigin: true },
        '/health': { target: backendTarget, changeOrigin: true },
      },
    },
  };
});
