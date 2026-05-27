/**
 * Beast portal API client (for features like chat that live on Beast itself,
 * not on this app's backend). Uses the user's existing SSO JWT.
 *
 * Note: this is intentionally separate from `utils/api.ts` (which talks to
 * our own /api/inquiries backend through the dev proxy). Calls here go
 * cross-origin to BEAST_PORTAL_URL; Beast's CORS is permissive.
 */
import axios, { type AxiosInstance } from 'axios';
import { getPortalUrl } from './portalUrl.ts';

let _instance: AxiosInstance | null = null;

export function beastApi(): AxiosInstance {
  if (_instance) return _instance;
  const inst = axios.create({
    baseURL: getPortalUrl(),
    timeout: 12_000,
  });
  inst.interceptors.request.use((config) => {
    const token = localStorage.getItem('beast_sso_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  inst.interceptors.response.use(
    (r) => r,
    (err) => {
      // On revoked token, let the app's SSO handler take over via its global event.
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        window.dispatchEvent(new CustomEvent('sso:unauthorized'));
      }
      return Promise.reject(err);
    },
  );
  _instance = inst;
  return inst;
}
