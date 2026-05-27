import axios from 'axios';
import { groupsMatch } from '../lib/groupKeys.ts';

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

function portalUrl() {
  return process.env.BEAST_PORTAL_URL || 'http://localhost:3000';
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
    const headers: Record<string, string> = { 'X-Api-Key': apiKey };
    if (process.env.BEAST_SECRET_KEY) headers['X-Secret-Key'] = process.env.BEAST_SECRET_KEY;
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
            ? (u.roles as Array<Record<string, unknown>>).map((r) => String(r.key || r.role_key || ''))
            : [],
        }))
      : [];
    return users;
  } catch (err) {
    console.warn('[beast-complaints] AD directory fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function getCachedDirectory(): Promise<DirectoryUser[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.users;
  const users = await fetchDirectory();
  cache = { fetchedAt: now, users };
  return users;
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
    if (u) result[id] = u.displayName || u.username;
  }
  return result;
}

export async function listGroupMembers(group: string): Promise<DirectoryUser[]> {
  const users = await getCachedDirectory();
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
 * Find a single directory user by email or username. Falls back to `null` if
 * the BEAST_API_KEY isn't configured or the directory doesn't include them.
 */
export async function findUser(identifier: string): Promise<DirectoryUser | null> {
  const id = identifier.trim().toLowerCase();
  if (!id) return null;
  const users = await getCachedDirectory();
  return (
    users.find(
      (u) =>
        u.email?.toLowerCase() === id ||
        u.username?.toLowerCase() === id ||
        `${u.username}@local`.toLowerCase() === id,
    ) || null
  );
}

export type { DirectoryUser };
