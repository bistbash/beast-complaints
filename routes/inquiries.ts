import { Router } from 'express';
import { pool } from '../config/db.ts';
import {
  authenticateBeastUser,
  buildCapabilities,
  isAdmin,
  isNavigator,
  isKeva,
  isManager,
  manageableGroups,
  targetGroups,
} from '../middleware/auth.ts';
import { configKeysForUserGroups, groupsMatch } from '../lib/groupKeys.ts';
import { humanizeIdentifier } from '../lib/humanize.ts';
import { loadDatasetMeta } from '../services/datasetMeta.ts';
import {
  changePriority,
  getInquiry,
  listHistory,
  listInquiries,
  listMessages,
  postMessage,
  reopenInquiry,
  routeInquiry,
  getStats,
  logHistory,
  submitTeamResponse,
  submitManagerResponse,
  setJustification,
  markClosingEmailSent,
} from '../services/inquiries.ts';
import {
  STATUS,
  PRIORITY,
  HISTORY_ACTION,
  MESSAGE_TYPE,
  JUSTIFICATION,
  DEFAULT_MANAGER_ROLE_KEYS,
  type InquiryStatus,
  type InquiryPriority,
  type JustificationDecision,
} from '../lib/constants.ts';
import { notifyGroup, sendNotification } from '../services/notifications.ts';
import { sendClosingEmail } from '../services/closingEmail.ts';
import {
  listGroupMembers,
  listManagers,
  resolveNames,
  findUser,
  fetchProfileAvatars,
} from '../services/userDirectory.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';

const router: Router = Router();
router.use(authenticateBeastUser);

function datasetId() {
  return process.env.COMPLAINTS_DATASET_ID || '';
}

async function requireDataset() {
  const meta = await loadDatasetMeta(datasetId(), pool);
  if (!meta) {
    const err = new Error(
      'Dataset של פניות לקוח לא הוגדר. צור את ה-dataset ב-db-smart וכוון את COMPLAINTS_DATASET_ID.',
    );
    (err as { status?: number }).status = 503;
    throw err;
  }
  return meta;
}

router.get('/capabilities', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({ capabilities: buildCapabilities(req.user) });
});

router.get('/lookup/groups', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const caps = buildCapabilities(req.user);
  // Anyone can SEE all routable target groups (for filtering / display).
  // But the routing dialog will use `manageable` to restrict the actual choices.
  res.json({
    groups: targetGroups(),
    manageable: caps.manageableGroups,
  });
});

async function enrichMembersWithAvatars<T extends { username: string }>(
  members: T[],
  token: string | undefined,
): Promise<Array<T & { avatarUrl: string | null }>> {
  const avatarMap = await fetchProfileAvatars(
    members.map((m) => m.username).filter(Boolean),
    token,
  );
  return members.map((m) => ({
    ...m,
    avatarUrl: avatarMap[m.username] || null,
  }));
}

router.get('/lookup/members', async (req, res, next) => {
  try {
    const group = String(req.query.group || '').trim();
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const caps = buildCapabilities(user);
    if (!process.env.BEAST_API_KEY) {
      res.json({
        members: [],
        warning:
          'BEAST_API_KEY לא הוגדר ב-.env — לא ניתן לטעון את חברי הקבוצה מ-AD. רשום את האפליקציה ב-Beast וקבל מפתח.',
      });
      return;
    }

    const managerRoles = (process.env.MANAGER_ROLE_KEYS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const wantedManagerRoles = managerRoles.length ? managerRoles : DEFAULT_MANAGER_ROLE_KEYS.map((s) => s.toLowerCase());
    const adminGroup = (process.env.ADMIN_GROUP || 'tichnun').toLowerCase();

    if (group) {
      const members = await listGroupMembers(group);
      const enriched = await enrichMembersWithAvatars(members, req.beastToken);
      res.json({
        members: enriched.map((m) => ({
          username: m.username,
          email: m.email,
          displayName: m.displayName || m.username,
          avatarUrl: m.avatarUrl,
          suggestedGroup: group,
          isManager:
            m.groups.map((g) => g.toLowerCase()).includes(adminGroup) ||
            (m.roles || []).some((r) => wantedManagerRoles.includes(r.toLowerCase())),
        })),
      });
      return;
    }

    const manageable = caps.manageableGroups || [];
    if (!manageable.length) {
      res.json({ members: [] });
      return;
    }

    const byUser = new Map<
      string,
      {
        username: string;
        email: string | null;
        displayName: string;
        isManager: boolean;
        suggestedGroup: string | null;
      }
    >();

    const grouped = await Promise.all(
      manageable.map(async (g) => ({
        group: g,
        members: await listGroupMembers(g),
      })),
    );

    for (const entry of grouped) {
      for (const m of entry.members) {
        const key = (m.email || m.username || '').toLowerCase();
        if (!key) continue;
        if (!byUser.has(key)) {
          byUser.set(key, {
            username: m.username,
            email: m.email,
            displayName: m.displayName || m.username,
            suggestedGroup: entry.group,
            isManager:
              m.groups.map((g) => g.toLowerCase()).includes(adminGroup) ||
              (m.roles || []).some((r) => wantedManagerRoles.includes(r.toLowerCase())),
          });
        }
      }
    }

    const list = Array.from(byUser.values());
    const enriched = await enrichMembersWithAvatars(list, req.beastToken);
    res.json({
      members: enriched.map((m) => ({
        username: m.username,
        email: m.email,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        suggestedGroup: m.suggestedGroup,
        isManager: m.isManager,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/lookup/managers', async (req, res, next) => {
  try {
    const adminGroup = process.env.ADMIN_GROUP || 'tichnun';
    const roleKeys = (process.env.MANAGER_ROLE_KEYS || '').trim()
      ? (process.env.MANAGER_ROLE_KEYS as string).split(',').map((s) => s.trim())
      : DEFAULT_MANAGER_ROLE_KEYS;
    const managers = await listManagers({ adminGroup, roleKeys });
    const enriched = await enrichMembersWithAvatars(managers, req.beastToken);
    res.json({
      managers: enriched.map((m) => ({
        username: m.username,
        email: m.email,
        displayName: m.displayName || m.username,
        avatarUrl: m.avatarUrl,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const meta = await requireDataset();
    const caps = buildCapabilities(req.user!);
    const limit = parseInt(String(req.query.limit || '50'), 10);
    const offset = parseInt(String(req.query.offset || '0'), 10);
    const search = req.query.q ? String(req.query.q) : undefined;
    const status = req.query.status ? (String(req.query.status) as InquiryStatus) : undefined;
    const priority = req.query.priority ? (String(req.query.priority) as InquiryPriority) : undefined;
    const view = String(req.query.view || 'inbox');

    const filter: Parameters<typeof listInquiries>[1] = { limit, offset, search, status, priority };

    if (view === 'closed') filter.open = false;
    else if (view === 'open') filter.open = true;
    if (req.query.group) filter.group = String(req.query.group);

    if (view === 'unrouted' && caps.canRoute) {
      filter.status = STATUS.NEW;
    }
    if (view === 'awaiting_manager' && (caps.isManager || caps.canViewAll)) {
      filter.status = STATUS.AWAITING_MANAGER;
    }
    if (view === 'awaiting_team') {
      filter.status = STATUS.ROUTED;
    }
    if (view === 'overdue') {
      filter.overdue = true;
    }

    if (view === 'mine_assigned') {
      filter.assignedUser = caps.email;
      // "My inquiries" defaults to open ones — closed ones live under /closed.
      filter.open = true;
    }

    // Visibility scoping for users who cannot view all (regular team members):
    // - they only see rows assigned directly to them OR routed to one of their groups.
    if (!caps.canViewAll && view !== 'mine_assigned') {
      filter.inboxForUserEmail = caps.email;
      // Map AD names (YOD A) → config keys (yod_a) so SQL matches assigned_group in DB.
      filter.inboxForUserGroups = configKeysForUserGroups(caps.groups, targetGroups());
    }

    const result = await listInquiries(meta, filter);
    const actorEmails = Array.from(
      new Set(result.rows.map((r) => r.assigned_user).filter((v): v is string => !!v)),
    );
    const names = actorEmails.length ? await resolveNames(actorEmails) : {};
    res.json({ inquiries: result.rows, pagination: result.pagination, displayNames: names });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const meta = await requireDataset();
    const stats = await getStats(meta);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const meta = await requireDataset();
    const inquiry = await getInquiry(meta, req.params.id);
    if (!inquiry) {
      res.status(404).json({ error: 'הפנייה לא נמצאה' });
      return;
    }
    const caps = buildCapabilities(req.user!);
    // Visibility check: regular users can only see if assigned to them or to one of their groups.
    if (!caps.canViewAll) {
      const ok =
        inquiry.assigned_user?.toLowerCase() === caps.email.toLowerCase() ||
        (inquiry.assigned_group &&
          caps.groups.some((ug) => groupsMatch(inquiry.assigned_group!, ug)));
      if (!ok) {
        res.status(403).json({ error: 'אין לך הרשאה לצפות בפנייה זו' });
        return;
      }
    }
    const [messages, history] = await Promise.all([
      listMessages(req.params.id),
      listHistory(req.params.id),
    ]);
    const actorEmails = [
      ...new Set([
        inquiry.assigned_user || '',
        inquiry.routed_by || '',
        inquiry.team_response_by || '',
        inquiry.manager_response_by || '',
        ...messages.map((m) => m.author),
        ...history.map((h) => h.actor),
      ].filter(Boolean)),
    ];
    const names = await resolveNames(actorEmails);
    res.json({ inquiry, messages, history, displayNames: names });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/route', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const caps = buildCapabilities(req.user);
    if (!caps.canRoute) {
      res.status(403).json({ error: 'נדרשת הרשאת נע"ט / מנהל / קבע' });
      return;
    }
    const meta = await requireDataset();
    const { group, assignedUser, routeToManager } = req.body || {};

    // Keva users can only route to groups they're members of.
    // Resolve "user-only" routing: if assignedUser is provided without group,
    // pick the first eligible group from the user's membership.
    let finalGroup: string = group;
    let finalAssignedUser: string | null = assignedUser || null;
    let finalAssignedUserLabel: string | null = null;
    let finalRouteToManager: boolean = !!routeToManager;

    if (finalAssignedUser && !finalGroup) {
      const u = await findUser(finalAssignedUser);
      if (!u) {
        res.status(400).json({ error: 'משתמש לא נמצא ב-AD' });
        return;
      }
      const candidates = u.groups.map((g) => g.toLowerCase() === 'teachers' ? 'morim' : g.toLowerCase());
      const allowed = caps.manageableGroups.map((g) => g.toLowerCase());
      const hasNonTeacherGroup = candidates.some((g) => g !== 'morim' && allowed.includes(g));
      const virtualTeacherCandidate = !hasNonTeacherGroup && allowed.includes('morim') ? 'morim' : null;
      const match = candidates.find((g) => allowed.includes(g)) || virtualTeacherCandidate;
      if (!match) {
        res.status(403).json({ error: 'המשתמש שבחרת אינו חבר בקבוצה שאתה מורשה לנתב אליה' });
        return;
      }
      finalGroup = match;
      finalAssignedUserLabel = u.displayName || humanizeIdentifier(finalAssignedUser);
    } else if (finalAssignedUser) {
      const u = await findUser(finalAssignedUser);
      finalAssignedUserLabel = u?.displayName || humanizeIdentifier(finalAssignedUser);
    }

    if (!finalGroup) {
      res.status(400).json({ error: 'יש לציין קבוצה או משתמש מטפל' });
      return;
    }

    // Permission check on the target group.
    const allowed = caps.manageableGroups.map((g) => g.toLowerCase());
    if (!allowed.includes(finalGroup.toLowerCase())) {
      res.status(403).json({
        error: caps.isKeva
          ? 'כחבר קבע אתה יכול לנתב רק לקבוצות שאתה חבר בהן'
          : 'אין לך הרשאה לנתב לקבוצה זו',
      });
      return;
    }

    // If routing to a user who is a manager, automatically set routeToManager=true.
    if (finalAssignedUser && !finalRouteToManager) {
      const u = await findUser(finalAssignedUser);
      if (u) {
        const adminGroup = (process.env.ADMIN_GROUP || 'tichnun').toLowerCase();
        const userIsAdmin = u.groups.map((g) => g.toLowerCase()).includes(adminGroup);
        const managerRoles = (process.env.MANAGER_ROLE_KEYS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        const wantedRoles = managerRoles.length ? managerRoles : DEFAULT_MANAGER_ROLE_KEYS;
        const userIsManagerByRole = (u.roles || []).some((r) => wantedRoles.includes(r.toLowerCase()));
        if (userIsAdmin || userIsManagerByRole) {
          finalRouteToManager = true;
        }
      }
    }

    const updated = await routeInquiry(meta, req.params.id, {
      group: finalGroup,
      assignedUser: finalAssignedUser,
      assignedUserLabel: finalAssignedUserLabel,
      routedBy: caps.email,
      routeToManager: finalRouteToManager,
    });
    if (!updated) {
      res.status(404).json({ error: 'הפנייה לא נמצאה' });
      return;
    }

    // Notifications:
    // 1) Notify the assigned user (if any).
    if (finalAssignedUser) {
      void sendNotification(req.params.id, finalAssignedUser, {
        title: finalRouteToManager ? 'פנייה ממתינה להתייחסות מנהל' : 'פנייה חדשה שויכה אליך',
        message: updated.subject,
        link: `/inquiries/${req.params.id}`,
        type: 'info',
      });
    } else {
      // 2) Otherwise notify the entire group.
      void notifyGroup(req.params.id, finalGroup, {
        title: 'פנייה נותבה לקבוצה שלך',
        message: updated.subject,
        link: `/inquiries/${req.params.id}`,
        type: 'info',
      });
    }
    res.json({ inquiry: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/team-response', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const meta = await requireDataset();
    const caps = buildCapabilities(req.user);
    const inquiry = await getInquiry(meta, req.params.id);
    if (!inquiry) {
      res.status(404).json({ error: 'הפנייה לא נמצאה' });
      return;
    }
    // Allowed: assigned user, keva, admin, navigator.
    const isAssignee = inquiry.assigned_user?.toLowerCase() === caps.email.toLowerCase();
    if (!isAssignee && !caps.isKeva && !caps.isAdmin && !caps.isNavigator) {
      res.status(403).json({ error: 'רק המטפל המשויך / קבע / נע"ט / מנהל יכולים לכתוב התייחסות צוות' });
      return;
    }
    if (inquiry.status !== STATUS.ROUTED) {
      res.status(409).json({ error: `לא ניתן לכתוב התייחסות צוות בסטטוס "${inquiry.status}"` });
      return;
    }
    const { content } = req.body || {};
    if (!content?.trim()) {
      res.status(400).json({ error: 'נדרש תוכן ההתייחסות' });
      return;
    }
    const updated = await submitTeamResponse(meta, req.params.id, content, caps.email, caps.displayName);

    // Notify managers.
    void (async () => {
      try {
        const envRoleKeys = (process.env.MANAGER_ROLE_KEYS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const managers = await listManagers({
          adminGroup: process.env.ADMIN_GROUP || 'tichnun',
          // An empty array is truthy, so `|| DEFAULT` never fired — check length explicitly.
          roleKeys: envRoleKeys.length ? envRoleKeys : DEFAULT_MANAGER_ROLE_KEYS,
        });
        await Promise.all(
          managers.map((m) =>
            sendNotification(req.params.id, m.email || `${m.username}@local`, {
              title: 'פנייה ממתינה להתייחסות מנהל',
              message: updated?.subject || '',
              link: `/inquiries/${req.params.id}`,
              type: 'info',
            }).catch(() => undefined),
          ),
        );
      } catch {}
    })();

    res.json({ inquiry: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/manager-response', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const meta = await requireDataset();
    const caps = buildCapabilities(req.user);
    if (!caps.isManager) {
      res.status(403).json({ error: 'נדרשת הרשאת מנהל (תפעול הדרכה / מד"ר)' });
      return;
    }
    const inquiry = await getInquiry(meta, req.params.id);
    if (!inquiry) {
      res.status(404).json({ error: 'הפנייה לא נמצאה' });
      return;
    }
    if (inquiry.status !== STATUS.AWAITING_MANAGER) {
      res.status(409).json({ error: `לא ניתן לכתוב התייחסות מנהל בסטטוס "${inquiry.status}"` });
      return;
    }
    const { content, justification } = req.body || {};
    if (!content?.trim()) {
      res.status(400).json({ error: 'נדרש תוכן ההתייחסות' });
      return;
    }
    if (justification !== JUSTIFICATION.JUSTIFIED && justification !== JUSTIFICATION.UNJUSTIFIED) {
      res.status(400).json({ error: 'יש להחליט אם הפנייה מוצדקת או לא מוצדקת לפני סגירה' });
      return;
    }
    const updated = await submitManagerResponse(
      meta,
      req.params.id,
      content,
      justification as JustificationDecision,
      caps.email,
      caps.displayName,
    );

    // Send the closing email synchronously so the manager gets immediate, accurate
    // feedback (sent / failed + reason). The inquiry is already closed in the DB
    // regardless of the email outcome — a failure here never blocks the close.
    let email: { sent: boolean; reason?: string } | null = null;
    if (updated) {
      try {
        const result = await sendClosingEmail(updated);
        if (result.ok) {
          await markClosingEmailSent(meta, updated.inquiry_id);
          email = { sent: true };
        } else {
          email = { sent: false, reason: result.reason };
          console.warn('[beast-complaints] closing email skipped:', result.reason);
        }
      } catch (err) {
        email = { sent: false, reason: 'send_failed' };
        console.warn('[beast-complaints] closing email error:', err instanceof Error ? err.message : err);
      }
    }

    // Re-fetch so closing_email_sent_at is reflected in the returned row.
    const finalInquiry = updated ? (await getInquiry(meta, req.params.id)) ?? updated : updated;
    res.json({ inquiry: finalInquiry, email });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resend-closing-email', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const meta = await requireDataset();
    const caps = buildCapabilities(req.user);
    if (!caps.isManager && !caps.isAdmin) {
      res.status(403).json({ error: 'רק מנהל יכול לשלוח את מייל הסגירה' });
      return;
    }
    const inquiry = await getInquiry(meta, req.params.id);
    if (!inquiry) {
      res.status(404).json({ error: 'הפנייה לא נמצאה' });
      return;
    }
    if (inquiry.status !== STATUS.CLOSED || !inquiry.manager_response) {
      res.status(409).json({ error: 'ניתן לשלוח מייל סגירה רק לפנייה שנסגרה בהתייחסות מנהל' });
      return;
    }
    const result = await sendClosingEmail(inquiry);
    if (result.ok) {
      await markClosingEmailSent(meta, inquiry.inquiry_id);
    }
    const finalInquiry = (await getInquiry(meta, req.params.id)) ?? inquiry;
    res.json({
      inquiry: finalInquiry,
      email: result.ok ? { sent: true } : { sent: false, reason: result.reason },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/justification', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const meta = await requireDataset();
    const caps = buildCapabilities(req.user);
    if (!caps.isManager) {
      res.status(403).json({ error: 'רק מנהל יכול להחליט אם פנייה מוצדקת' });
      return;
    }
    const { justification } = req.body || {};
    if (justification !== JUSTIFICATION.JUSTIFIED && justification !== JUSTIFICATION.UNJUSTIFIED) {
      res.status(400).json({ error: 'justification חייב להיות "justified" או "unjustified"' });
      return;
    }
    const updated = await setJustification(meta, req.params.id, justification, caps.email);
    if (!updated) {
      res.status(404).json({ error: 'הפנייה לא נמצאה' });
      return;
    }
    res.json({ inquiry: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reopen', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const meta = await requireDataset();
    const caps = buildCapabilities(req.user);
    if (!caps.isManager && !caps.isAdmin) {
      res.status(403).json({ error: 'רק מנהל יכול לפתוח פנייה מחדש' });
      return;
    }
    const updated = await reopenInquiry(meta, req.params.id, caps.email, req.body?.note);
    if (!updated) {
      res.status(404).json({ error: 'הפנייה לא נמצאה' });
      return;
    }
    res.json({ inquiry: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/priority', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const meta = await requireDataset();
    const caps = buildCapabilities(req.user);
    if (!caps.canRoute && !caps.isManager) {
      res.status(403).json({ error: 'אין לך הרשאה לשנות דחיפות' });
      return;
    }
    const { priority } = req.body || {};
    if (!priority || !Object.values(PRIORITY).includes(priority)) {
      res.status(400).json({ error: 'דחיפות לא חוקית' });
      return;
    }
    const updated = await changePriority(meta, req.params.id, priority, caps.email);
    if (!updated) {
      res.status(404).json({ error: 'הפנייה לא נמצאה' });
      return;
    }
    res.json({ inquiry: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/messages', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const meta = await requireDataset();
    const caps = buildCapabilities(req.user);
    const inquiry = await getInquiry(meta, req.params.id);
    if (!inquiry) {
      res.status(404).json({ error: 'הפנייה לא נמצאה' });
      return;
    }
    // Permission gate: same as inquiry visibility.
    if (!caps.canViewAll) {
      const ok =
        inquiry.assigned_user?.toLowerCase() === caps.email.toLowerCase() ||
        (inquiry.assigned_group &&
          caps.groups.some((ug) => groupsMatch(inquiry.assigned_group!, ug)));
      if (!ok) {
        res.status(403).json({ error: 'אין לך הרשאה להגיב על פנייה זו' });
        return;
      }
    }
    const { content } = req.body || {};
    if (!content?.trim()) {
      res.status(400).json({ error: 'תוכן ההודעה נדרש' });
      return;
    }
    const message = await postMessage(
      pool,
      req.params.id,
      caps.email,
      caps.displayName,
      content.trim(),
      MESSAGE_TYPE.COMMENT,
    );
    await logHistory(pool, req.params.id, caps.email, HISTORY_ACTION.COMMENT_ADDED, {});

    await pool
      .query(
        `UPDATE ${quoteIdent(meta.tableName)} SET "last_activity_at" = NOW() WHERE "inquiry_id" = $1`,
        [req.params.id],
      )
      .catch(() => undefined);

    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

export default router;
