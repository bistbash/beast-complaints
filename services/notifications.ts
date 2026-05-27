import axios from 'axios';
import { pool } from '../config/db.ts';

interface NotificationPayload {
  title: string;
  message: string;
  link?: string;
  type?: 'info' | 'success' | 'warning' | 'error';
}

/**
 * Send a notification via the Beast notifications API (if API key configured).
 * Always records the attempt in `complaints_notifications` regardless of channel.
 */
export async function sendNotification(
  inquiryId: string,
  recipient: string,
  payload: NotificationPayload,
): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = process.env.BEAST_API_KEY;
  await pool.query(
    `INSERT INTO complaints_notifications (inquiry_id, recipient, channel, payload, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [inquiryId, recipient, apiKey ? 'beast' : 'log', payload],
  );

  if (!apiKey) {
    return { ok: false, reason: 'no_api_key' };
  }

  try {
    const portal = process.env.BEAST_PORTAL_URL || 'http://localhost:3000';
    await axios.post(
      `${portal}/api/app-notifications/send`,
      {
        username: recipient.replace(/@.*/, ''),
        title: payload.title,
        message: payload.message,
        link: payload.link,
        type: payload.type || 'info',
      },
      { headers: { 'X-Api-Key': apiKey }, timeout: 5000 },
    );
    await pool.query(
      `UPDATE complaints_notifications
          SET status = 'sent', sent_at = NOW()
        WHERE inquiry_id = $1 AND recipient = $2 AND status = 'pending'`,
      [inquiryId, recipient],
    );
    return { ok: true };
  } catch (err) {
    console.warn('[beast-complaints] notification send failed:', err instanceof Error ? err.message : err);
    await pool.query(
      `UPDATE complaints_notifications
          SET status = 'failed', sent_at = NOW()
        WHERE inquiry_id = $1 AND recipient = $2 AND status = 'pending'`,
      [inquiryId, recipient],
    );
    return { ok: false, reason: 'send_failed' };
  }
}

export async function notifyGroup(
  inquiryId: string,
  group: string,
  payload: NotificationPayload,
): Promise<void> {
  const apiKey = process.env.BEAST_API_KEY;
  if (!apiKey) {
    console.info('[beast-complaints] notifyGroup skipped (no BEAST_API_KEY)', { group, inquiryId });
    return;
  }
  try {
    const { listGroupMembers } = await import('./userDirectory.ts');
    const members = await listGroupMembers(group);
    await Promise.all(
      members.map((m) =>
        sendNotification(inquiryId, m.email || `${m.username}@local`, payload).catch(() => undefined),
      ),
    );
  } catch (err) {
    console.warn('[beast-complaints] notifyGroup failed:', err instanceof Error ? err.message : err);
  }
}
