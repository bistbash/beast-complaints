import axios from 'axios';
import { groupsMatch } from '../lib/groupKeys.ts';
import { DEFAULT_TARGET_GROUPS } from '../lib/constants.ts';
import { humanizeIdentifier } from '../lib/humanize.ts';

/**
 * Lightweight Beast directory client — resolves emails / usernames to display
 * names. Falls back gracefully when the BEAST_API_KEY isn't configured
 * (we just return the raw email).
 */

interface DirectoryUser {
  username: string;
  email: string | null;
  displayName: string | null;
  groups: string[];
  roles?: string[];
}

let cache: { fetchedAt: number; users: DirectoryUser[] } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Platform roles are not on the AD directory payload — they live in Beast user_roles. */
const roleCache = new Map<string, { fetchedAt: number; roles: string[] }>();
const roleInflight = new Map<string, Promise<string[]>>();
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;

function portalUrl() {
  return process.env.BEAST_PORTAL_URL || 'http://localhost:3000';
}

function beastHeaders(): Record<string, string> | null {
  const apiKey = process.env.BEAST_API_KEY;
  if (!apiKey) return null;
  const headers: Record<string, string> = { 'X-Api-Key': apiKey };
  if (process.env.BEAST_SECRET_KEY) headers['X-Secret-Key'] = process.env.BEAST_SECRET_KEY;
  return headers;
}

let warnedAboutMissingKey = false;

async function fetchDirectory(): Promise<DirectoryUser[]> {
  const apiKey = process.env.BEAST_API_KEY;
  if (!apiKey) {
    if (!warnedAboutMissingKey) {
      warnedAboutMissingKey = true;
      console.warn(
        '[beast-complaints] BEAST_API_KEY חסר ב-.env — לא ניתן לטעון רשימת משתמשים מ-AD.\n' +
          '  → רשום את האפליקציה ב-Beast Admin Panel וקבע BEAST_API_KEY ב-.env.\n' +
          '  → ניתוב לפי קבוצה ימשיך לעבוד; ניתוב לחבר צוות ספציפי דורש את המפתח.',
      );
    }
    return [];
  }
  try {
    const headers = beastHeaders();
    if (!headers) return [];
    const { data } = await axios.get(`${portalUrl()}/api/app-permissions/directory/users`, {
      headers,
      timeout: 8000,
    });
    const users: DirectoryUser[] = Array.isArray(data?.users)
      ? data.users.map((u: Record<string, unknown>) => ({
          username: String(u.username || ''),
          email: (u.email as string) || (u.mail as string) || null,
          displayName: (u.display_name as string) || (u.displayName as string) || (u.name as string) || null,
          groups: Array.isArray(u.groups) ? (u.groups as string[]) : [],
          roles: Array.isArray(u.roles)
            ? (u.roles as Array<string | Record<string, unknown>>)
                .map((r) => (typeof r === 'string' ? r : String(r.key || r.role_key || '')))
                .filter(Boolean)
            : [],
        }))
      : [];
    return users;
  } catch (err) {
    console.warn('[beast-complaints] AD directory fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

function roleKeysFromPayload(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => (typeof r === 'string' ? r : String((r as { key?: string; role_key?: string }).key || (r as { role_key?: string }).role_key || '')))
    .map((r) => r.trim())
    .filter(Boolean);
}

async function fetchRoleKeys(username: string): Promise<string[]> {
  const key = username.trim().toLowerCase();
  if (!key) return [];
  const cached = roleCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ROLE_CACHE_TTL_MS) return cached.roles;
  const pending = roleInflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const headers = beastHeaders();
    if (!headers) return [];
    try {
      const { data } = await axios.get(
        `${portalUrl()}/api/user-roles/app/users/${encodeURIComponent(key)}`,
        { headers, timeout: 8000 },
      );
      const roles = roleKeysFromPayload(data?.user?.roles);
      roleCache.set(key, { fetchedAt: Date.now(), roles });
      return roles;
    } catch (err) {
      console.warn(
        '[beast-complaints] role lookup failed for',
        key,
        err instanceof Error ? err.message : err,
      );
      return [];
    } finally {
      roleInflight.delete(key);
    }
  })();

  roleInflight.set(key, job);
  return job;
}

/** Fill `roles` from Beast for users the AD directory payload left blank. Cached for 5 minutes. */
export async function ensureUserRoles(users: DirectoryUser[]): Promise<void> {
  const pending = users.filter((u) => u.username && !(u.roles && u.roles.length));
  const usernames = Array.from(new Set(pending.map((u) => u.username.trim().toLowerCase())));
  const byName = new Map<string, string[]>();
  const queue = [...usernames];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      const name = queue.shift();
      if (!name) return;
      byName.set(name, await fetchRoleKeys(name));
    }
  });
  await Promise.all(workers);
  for (const user of pending) {
    const roles = byName.get(user.username.trim().toLowerCase());
    if (roles) user.roles = roles;
  }
}

async function getCachedDirectory(): Promise<DirectoryUser[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.users;
  const users = await fetchDirectory();
  cache = { fetchedAt: now, users };
  return users;
}

function normalizeGroup(value: string): string {
  const v = String(value || '').trim().toLowerCase();
  return v === 'teachers' ? 'morim' : v;
}

function configuredTargetGroups(): string[] {
  const env = (process.env.TARGET_GROUPS || '').trim();
  const raw = env ? env.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_TARGET_GROUPS.map((g) => g.key);
  return Array.from(new Set(raw.map(normalizeGroup)));
}

function belongsToTeacherVirtualGroup(user: DirectoryUser): boolean {
  const nonTeacherTargets = configuredTargetGroups().filter((g) => g !== 'morim');
  if (nonTeacherTargets.length === 0) return true;
  const userGroups = (user.groups || []).map(normalizeGroup);
  return !userGroups.some((g) => nonTeacherTargets.includes(g));
}

export async function resolveNames(identifiers: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(identifiers.filter(Boolean).map((s) => s.toLowerCase())));
  if (!unique.length) return {};
  const users = await getCachedDirectory();
  const result: Record<string, string> = {};
  for (const id of unique) {
    const u = users.find(
      (x) =>
        x.email?.toLowerCase() === id ||
        x.username?.toLowerCase() === id ||
        `${x.username}@local`.toLowerCase() === id,
    );
    // Always return a readable name — even when the directory is empty
    // (e.g. BEAST_API_KEY missing), fall back to a humanized identifier
    // rather than leaking a placeholder into the UI.
    result[id] = u?.displayName || humanizeIdentifier(id);
  }
  return result;
}

export async function listGroupMembers(group: string): Promise<DirectoryUser[]> {
  const users = await getCachedDirectory();
  const wanted = normalizeGroup(group);
  if (wanted === 'morim') {
    return users.filter((u) => belongsToTeacherVirtualGroup(u));
  }
  return users.filter((u) => u.groups.some((g) => groupsMatch(group, g)));
}

export async function listAllGroups(): Promise<string[]> {
  const users = await getCachedDirectory();
  const groups = new Set<string>();
  for (const u of users) for (const g of u.groups) groups.add(g);
  return Array.from(groups).sort((a, b) => a.localeCompare(b));
}

/**
 * List users that are "managers" — either members of the admin group OR holders of
 * any of the configured manager role keys (defaults to `madr` = מד"ר).
 */
export async function listManagers(opts: { adminGroup: string; roleKeys: string[] }): Promise<DirectoryUser[]> {
  const users = await getCachedDirectory();
  // Roles are filled lazily (routing / member search). Users already resolved
  // keep their roles on the cached directory object, so מד"ר / מנהל בית הספר
  // who were looked up are included here together with the admin group.
  const admin = opts.adminGroup.toLowerCase();
  const roleSet = new Set(opts.roleKeys.map((r) => r.toLowerCase()));
  return users.filter((u) => {
    const groups = u.groups.map((g) => g.toLowerCase());
    if (groups.includes(admin)) return true;
    const roles = (u.roles || []).map((r) => r.toLowerCase());
    return roles.some((r) => roleSet.has(r));
  });
}

/**
 * List users who can route inquiries — navigators (by role key), admins (admin
 * group), and keva members. Used to alert "someone responsible" when a still-
 * unrouted inquiry breaches its SLA.
 */
export async function listNavigators(opts: {
  adminGroup: string;
  navigatorRoleKeys: string[];
  kevaGroup: string;
}): Promise<DirectoryUser[]> {
  const users = await getCachedDirectory();
  const admin = opts.adminGroup.toLowerCase();
  const navKeys = new Set(opts.navigatorRoleKeys.map((k) => k.toLowerCase()));
  const keva = opts.kevaGroup.toLowerCase();
  return users.filter((u) => {
    const groups = u.groups.map((g) => g.toLowerCase());
    if (groups.includes(admin) || groups.includes(keva)) return true;
    const roles = (u.roles || []).map((r) => r.toLowerCase());
    return roles.some((r) => navKeys.has(r));
  });
}

/**
 * Find a single directory user by email or username. Falls back to `null` if
 * the BEAST_API_KEY isn't configured or the directory doesn't include them.
 */
export async function findUser(identifier: string): Promise<DirectoryUser | null> {
  const id = identifier.trim().toLowerCase();
  if (!id) return null;
  const users = await getCachedDirectory();
  const found =
    users.find(
      (u) =>
        u.email?.toLowerCase() === id ||
        u.username?.toLowerCase() === id ||
        `${u.username}@local`.toLowerCase() === id,
    ) || null;
  if (found) await ensureUserRoles([found]);
  return found;
}

/** Fetch Beast profile avatars in batches (requires user SSO token). */
export async function fetchProfileAvatars(
  usernames: string[],
  token: string | null | undefined,
): Promise<Record<string, string>> {
  if (!token || !usernames.length) return {};
  const base = portalUrl().replace(/\/$/, '');
  const results: Record<string, string> = {};
  try {
    for (let i = 0; i < usernames.length; i += 80) {
      const batch = usernames.slice(i, i + 80);
      const { data } = await axios.get(`${base}/api/profile/batch`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { usernames: batch.join(',') },
        timeout: 8000,
      });
      const profiles = data?.profiles || data;
      if (profiles && typeof profiles === 'object') {
        for (const [uname, profile] of Object.entries(profiles as Record<string, { avatar_url?: string }>)) {
          const path = profile?.avatar_url;
          if (path) results[uname] = path.startsWith('http') ? path : `${base}${path}`;
        }
      }
    }
  } catch (err) {
    console.warn('[beast-complaints] profile batch fetch failed:', err instanceof Error ? err.message : err);
  }
  return results;
}

export type { DirectoryUser };
