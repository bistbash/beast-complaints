/**
 * Beast portal URL — in production the server injects
 * window.__BEAST_PORTAL_URL__ from the BEAST_PORTAL_URL env var.
 * We MUST check the injected value before falling back to import.meta.env
 * (which is fixed at build time and can otherwise stay as localhost:3000).
 */
export function getPortalUrl(): string {
  if (typeof window !== 'undefined' && window.__BEAST_PORTAL_URL__) {
    return String(window.__BEAST_PORTAL_URL__).replace(/\/+$/, '');
  }
  const vite = import.meta.env.VITE_PORTAL_URL;
  if (vite && vite !== 'http://localhost:3000') {
    return String(vite).replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}
