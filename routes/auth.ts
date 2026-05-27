import { Router } from 'express';
import axios from 'axios';

const router: Router = Router();

const getPortalApi = () =>
  process.env.BEAST_PORTAL_URL || process.env.BEAST_PORTAL_API || 'http://localhost:3000';

function getBaseUrl(req: import('express').Request): string {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString();
  return `${proto}://${req.get('host')}`;
}

function getAppMeta(req: import('express').Request) {
  const baseUrl = process.env.APP_URL || getBaseUrl(req);
  return {
    app_id: process.env.APP_ID || 'beast-complaints',
    app_url: baseUrl,
    slo_callback_url: `${baseUrl}/auth/slo/callback`,
  };
}

router.post('/validate', async (req, res) => {
  const token = req.body?.token;
  if (!token) {
    res.status(400).json({ success: false, valid: false, error: 'No token provided' });
    return;
  }

  try {
    const portal = getPortalApi();
    const { data } = await axios.post(
      `${portal}/auth/sso/validate`,
      { token, ...getAppMeta(req) },
      { timeout: 8000 },
    );
    if (!data?.success || !data?.valid) {
      res.status(401).json({ success: false, valid: false, error: data?.error || 'Invalid token' });
      return;
    }

    let avatarUrl: string | null = null;
    try {
      const profileRes = await axios.get(`${portal}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 3000,
      });
      const profilePath = profileRes.data?.profile?.avatar_url;
      if (profilePath) {
        avatarUrl = profilePath.startsWith('http') ? profilePath : `${portal}${profilePath}`;
      }
    } catch {}

    const user = {
      ...data.user,
      avatarUrl: avatarUrl || data.user?.avatarUrl || data.user?.avatar_url || null,
    };
    res.json({ success: true, valid: true, user });
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      res.status(401).json({
        success: false,
        valid: false,
        error: err.response.data?.error || 'טוקן לא תקף',
        revoked: err.response.data?.revoked || false,
      });
      return;
    }
    res.status(503).json({ success: false, valid: false, error: 'Failed to validate with Beast' });
  }
});

router.get('/slo/status', async (req, res) => {
  const token = (req.query?.token as string) || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.json({ active: false, reason: 'no_token' });
    return;
  }

  try {
    const portal = getPortalApi();
    const { data } = await axios.get(`${portal}/auth/slo/status`, {
      params: { token },
      timeout: 5000,
    });
    res.json(data);
  } catch (err) {
    if (!axios.isAxiosError(err) || !err.response) {
      res.json({ active: true });
      return;
    }
    res.json(err.response.data || { active: false, reason: 'error' });
  }
});

router.post('/slo/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.body?.token;
  if (!token) {
    res.status(400).json({ success: false, error: 'No token provided' });
    return;
  }

  try {
    const portal = getPortalApi();
    const { data } = await axios.post(
      `${portal}/auth/slo/logout`,
      {},
      { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 },
    );
    res.json(data);
  } catch {
    res.json({ success: false, error: 'Failed to logout in Beast' });
  }
});

router.post('/slo/callback', (_req, res) => {
  res.json({ success: true });
});

export default router;
