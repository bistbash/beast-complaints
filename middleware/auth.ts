import type { Request, Response, NextFunction, RequestHandler } from 'express';
import axios from 'axios';
import type { BeastUser, UserCapabilities } from '../lib/types.ts';
import { DEFAULT_KEVA_GROUP, DEFAULT_MANAGER_ROLE_KEYS, DEFAULT_TARGET_GROUPS } from '../lib/constants.ts';
import { configKeysForUserGroups } from '../lib/groupKeys.ts';
import { humanizeIdentifier } from '../lib/humanize.ts';

function getPortalApi(): string {
  return process.env.BEAST_PORTAL_URL || process.env.BEAST_PORTAL_API || 'http://localhost:3000';
}

function getAppMeta(req: Request) {
  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  return {
    app_id: process.env.APP_ID || 'beast-complaints',
    app_url: baseUrl,
    slo_callback_url: `${baseUrl}/auth/slo/callback`,
  };
}

export const authenticateBeastUser: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    res.status(401).json({ error: 'נדרש אסימון גישה' });
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
      res.status(401).json({ error: data?.error || 'אסימון לא תקף' });
      return;
    }

    req.user = {
      ...(data.user as Partial<BeastUser>),
      groups: Array.isArray(data.user?.groups) ? data.user.groups : [],
      roles: Array.isArray(data.user?.roles) ? data.user.roles : [],
    } as BeastUser;
    req.beastToken = token;
    next();
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      res.status(401).json({ error: 'אסימון לא תקף או פג תוקף' });
      return;
    }
    console.warn('[beast-complaints] Beast validation failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'אימות מול Beast נכשל' });
  }
};

function normalize(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function canonicalGroup(value: string): string {
  const v = normalize(value);
  return v === 'teachers' ? 'morim' : v;
}

function adminGroupName(): string {
  return normalize(process.env.ADMIN_GROUP || 'tichnun');
}

function navigatorRoleKey(): string {
  return normalize(process.env.NAVIGATOR_ROLE_KEY || 'naat_pniot_lakoach');
}

function managerRoleKeys(): string[] {
  const env = (process.env.MANAGER_ROLE_KEYS || '').trim();
  const list = env ? env.split(',').map(normalize).filter(Boolean) : DEFAULT_MANAGER_ROLE_KEYS;
  return list.length ? list : DEFAULT_MANAGER_ROLE_KEYS;
}

function kevaGroupName(): string {
  return normalize(process.env.KEVA_GROUP || DEFAULT_KEVA_GROUP);
}

export function targetGroups(): string[] {
  const env = (process.env.TARGET_GROUPS || '').trim();
  const raw = env ? env.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_TARGET_GROUPS.map((g) => g.key);
  const canonical = raw.map(canonicalGroup);
  if (!canonical.includes('morim')) canonical.push('morim');
  // Keep order stable while removing aliases/duplicates (e.g. teachers -> morim).
  return Array.from(new Set(canonical));
}

function userGroupsWithTeachersFallback(user: BeastUser): string[] {
  const groups = (user.groups || []).map(canonicalGroup);
  const targets = targetGroups();
  const nonTeacherTargets = targets.filter((g) => g !== 'morim');
  const belongsToOtherTarget = groups.some((g) => nonTeacherTargets.includes(g));
  if (!belongsToOtherTarget) groups.push('morim');
  return Array.from(new Set(groups));
}

export function isAdmin(user: BeastUser): boolean {
  return (user.groups || []).map(normalize).includes(adminGroupName());
}

export function isNavigator(user: BeastUser): boolean {
  const key = navigatorRoleKey();
  const roles = (user.roles || []).map((r) => normalize(r?.key || ''));
  if (roles.includes(key)) return true;
  // Defensive fallback: accept an identically-named AD group.
  return (user.groups || []).map(normalize).includes(key);
}

export function isManager(user: BeastUser): boolean {
  if (isAdmin(user)) return true;
  const wanted = managerRoleKeys();
  const roles = (user.roles || []).map((r) => normalize(r?.key || ''));
  return roles.some((r) => wanted.includes(r));
}

export function isKeva(user: BeastUser): boolean {
  return (user.groups || []).map(normalize).includes(kevaGroupName());
}

/**
 * Groups the user can route inquiries TO.
 *
 * - Navigator / admin: all configured target groups.
 * - Keva member: intersection of user's groups with target groups (i.e. only
 *   the teams they're personally a member of).
 * - Other users: empty.
 */
export function manageableGroups(user: BeastUser): string[] {
  const targets = targetGroups().map(normalize);
  const userGroups = userGroupsWithTeachersFallback(user);
  if (isNavigator(user) || isAdmin(user)) {
    return targets;
  }
  if (isKeva(user)) {
    return configKeysForUserGroups(userGroups, targets);
  }
  return [];
}

export function buildCapabilities(user: BeastUser): UserCapabilities {
  const effectiveGroups = userGroupsWithTeachersFallback(user);
  const admin = isAdmin(user);
  const navigator = isNavigator(user);
  const manager = isManager(user);
  const keva = isKeva(user);
  const manageable = manageableGroups(user);
  return {
    isAdmin: admin,
    isNavigator: navigator,
    isManager: manager,
    isKeva: keva,
    groups: effectiveGroups,
    manageableGroups: manageable,
    email: user.email || `${user.username}@local`,
    displayName: user.displayName || humanizeIdentifier(user.email || user.username),
    username: user.username,
    canRoute: navigator || admin || keva,
    canViewAll: navigator || admin || manager || keva,
    canWriteTeamResponse: true, // gated per-inquiry (must be the assigned_user OR keva/admin)
    canWriteManagerResponse: manager,
    canManageEmail: admin,
  };
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'נדרשת התחברות' });
    return;
  }
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: 'נדרשת הרשאת מנהל' });
    return;
  }
  next();
};

export const requireRouter: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'נדרשת התחברות' });
    return;
  }
  if (!isNavigator(req.user) && !isAdmin(req.user) && !isKeva(req.user)) {
    res.status(403).json({ error: 'נדרשת הרשאת נע"ט / מנהל / קבע' });
    return;
  }
  next();
};

export const requireManager: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'נדרשת התחברות' });
    return;
  }
  if (!isManager(req.user)) {
    res.status(403).json({ error: 'נדרשת הרשאת מנהל (תפעול הדרכה או מד"ר)' });
    return;
  }
  next();
};
