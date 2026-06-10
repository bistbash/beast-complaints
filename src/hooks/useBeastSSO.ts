import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../utils/api.ts';
import { getPortalUrl } from '../utils/portalUrl.ts';
import { invalidateCapabilities } from './useCapabilities.ts';

interface BeastUser {
  username: string;
  displayName?: string;
  email?: string;
  groups: string[];
  roles?: Array<{ key: string; data?: unknown }>;
  avatarUrl?: string | null;
}

const TOKEN_KEY = 'beast_sso_token';
const USER_KEY = 'beast_complaints_user';
const SLO_POLL_INTERVAL = 10_000;
const BROADCAST_CHANNEL = 'beast_sso_channel';
const PENDING_TOKEN_KEY = 'beast_sso_pending_token';

function portalPointsToThisApp(portalBase: string): boolean {
  try {
    return new URL(portalBase).origin === window.location.origin;
  } catch {
    return true;
  }
}

const _url = new URL(window.location.href);
const _ssoToken = _url.searchParams.get('sso_token');
if (_ssoToken) {
  sessionStorage.setItem(PENDING_TOKEN_KEY, _ssoToken);
  _url.searchParams.delete('sso_token');
  window.history.replaceState({}, document.title, _url.pathname + _url.search);
}

let urlTokenValidationInProgress = false;

function redirectToPortalSSO() {
  const portal = getPortalUrl();
  const appUrl = encodeURIComponent(window.location.origin + window.location.pathname);
  window.location.replace(`${portal}/sso/redirect?app_url=${appUrl}`);
}

function redirectToPortalLogin() {
  const portal = getPortalUrl();
  const appUrl = encodeURIComponent(window.location.origin + window.location.pathname);
  window.location.replace(`${portal}/login?redirect=${appUrl}`);
}

function redirectToPortal() {
  window.location.replace(getPortalUrl());
}

async function raceValidate(validateFn: () => Promise<boolean>, ms = 20000): Promise<boolean> {
  let finished = false;
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => {
      if (!finished) resolve(false);
    }, ms),
  );
  const main = validateFn()
    .then((r) => {
      finished = true;
      return r;
    })
    .catch(() => {
      finished = true;
      return false;
    });
  return Promise.race([main, timeout]);
}

export interface UseBeastSSO {
  user: BeastUser | null;
  loading: boolean;
  authenticated: boolean;
  ssoConfigError: string | null;
  logout: () => Promise<void>;
}

export default function useBeastSSO(): UseBeastSSO {
  const pendingTokenRef = useRef<string | null>(sessionStorage.getItem(PENDING_TOKEN_KEY));
  const cachedUser = ((): BeastUser | null => {
    try {
      const s = localStorage.getItem(USER_KEY);
      return s ? (JSON.parse(s) as BeastUser) : null;
    } catch {
      return null;
    }
  })();

  const cachedToken = localStorage.getItem(TOKEN_KEY);
  const hasPendingToken = !!pendingTokenRef.current;
  const hasCache = !!(cachedUser && cachedToken) && !hasPendingToken;

  const [user, setUser] = useState<BeastUser | null>(hasCache ? cachedUser : null);
  const [loading, setLoading] = useState(!hasCache);
  const [authenticated, setAuthenticated] = useState(hasCache);
  const [ssoConfigError, setSsoConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading || ssoConfigError) return;
    const t = window.setTimeout(() => {
      setSsoConfigError(
        'הטעינה ארכה יותר מדי (40 שניות). פתח את כלי המפתחים (F12) → Console ו-Network, בדוק את /auth/validate ואת BEAST_PORTAL_URL.',
      );
      setLoading(false);
    }, 40_000);
    return () => window.clearTimeout(t);
  }, [loading, ssoConfigError]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirecting = useRef(false);
  const bcRef = useRef<BroadcastChannel | null>(null);

  const clearLocal = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(PENDING_TOKEN_KEY);
    invalidateCapabilities();
    setUser(null);
    setAuthenticated(false);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const safeRedirect = useCallback((fn: () => void) => {
    if (redirecting.current) return;
    redirecting.current = true;
    fn();
  }, []);

  const broadcastLogout = useCallback(() => {
    try {
      bcRef.current?.postMessage({ type: 'beast_sso_logout', ts: Date.now() });
    } catch {}
  }, []);

  const validate = useCallback(async (token: string): Promise<boolean> => {
    try {
      const { data } = await api.post('/auth/validate', { token });
      if (data?.success && data?.valid) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        setUser(data.user);
        setAuthenticated(true);
        return true;
      }
    } catch {}
    return false;
  }, []);

  useEffect(() => {
    const onLogout = () => {
      stopPolling();
      clearLocal();
      safeRedirect(redirectToPortal);
    };

    try {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL);
      bc.onmessage = (e) => {
        if (e.data?.type === 'beast_sso_logout') onLogout();
      };
      bcRef.current = bc;
    } catch {}

    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'beast_sso_logout') onLogout();
    };
    window.addEventListener('message', onMsg);

    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY && !e.newValue) onLogout();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      bcRef.current?.close();
      window.removeEventListener('message', onMsg);
      window.removeEventListener('storage', onStorage);
    };
  }, [stopPolling, clearLocal, safeRedirect]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (redirecting.current) return;
      const t = localStorage.getItem(TOKEN_KEY);
      if (!t) {
        stopPolling();
        return;
      }
      try {
        const { data } = await api.get('/auth/slo/status', { params: { token: t } });
        if (!data.active) {
          stopPolling();
          clearLocal();
          broadcastLogout();
          safeRedirect(redirectToPortal);
        }
      } catch {}
    }, SLO_POLL_INTERVAL);
  }, [stopPolling, clearLocal, broadcastLogout, safeRedirect]);

  useEffect(() => {
    const h = () => {
      stopPolling();
      clearLocal();
      broadcastLogout();
      safeRedirect(redirectToPortal);
    };
    window.addEventListener('sso:unauthorized', h);
    return () => window.removeEventListener('sso:unauthorized', h);
  }, [stopPolling, clearLocal, broadcastLogout, safeRedirect]);

  const logout = useCallback(async () => {
    if (redirecting.current) return;
    redirecting.current = true;
    stopPolling();
    const t = localStorage.getItem(TOKEN_KEY);
    clearLocal();
    broadcastLogout();
    if (t) {
      try {
        await api.post('/auth/slo/logout', { token: t });
      } catch {}
    }
    window.location.replace(getPortalUrl());
  }, [stopPolling, clearLocal, broadcastLogout]);

  useEffect(() => {
    let dead = false;

    async function init() {
      const portal = getPortalUrl();

      if (portalPointsToThisApp(portal)) {
        setSsoConfigError(
          'כתובת פורטל ה-SSO זהה לכתובת האפליקציה. הגדר BEAST_PORTAL_URL לכתובת Beast (לא לפורט של האפליקציה הזו).',
        );
        setLoading(false);
        return;
      }

      if (urlTokenValidationInProgress) {
        const deadline = Date.now() + 4000;
        const check = () => {
          if (dead) return;
          const token = localStorage.getItem(TOKEN_KEY);
          const userJson = localStorage.getItem(USER_KEY);
          if (token && userJson) {
            try {
              setUser(JSON.parse(userJson));
              setAuthenticated(true);
              setLoading(false);
              startPolling();
            } catch {}
            return;
          }
          if (Date.now() < deadline) setTimeout(check, 80);
          else {
            setLoading(false);
            safeRedirect(redirectToPortalSSO);
          }
        };
        setTimeout(check, 120);
        return;
      }

      const urlToken = pendingTokenRef.current;
      if (urlToken) {
        pendingTokenRef.current = null;
        sessionStorage.removeItem(PENDING_TOKEN_KEY);
        urlTokenValidationInProgress = true;
        try {
          const ok = await raceValidate(() => validate(urlToken));
          if (dead) return;
          if (ok) {
            startPolling();
            setLoading(false);
            return;
          }
          clearLocal();
          safeRedirect(redirectToPortalLogin);
        } finally {
          urlTokenValidationInProgress = false;
        }
        return;
      }

      if (cachedToken) {
        const ok = await raceValidate(() => validate(cachedToken));
        if (dead) return;
        if (ok) {
          startPolling();
          setLoading(false);
          return;
        }
        clearLocal();
        safeRedirect(redirectToPortalLogin);
        return;
      }

      safeRedirect(redirectToPortalSSO);
    }

    init();
    return () => {
      dead = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { user, loading, authenticated, logout, ssoConfigError };
}
