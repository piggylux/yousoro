import { daysAgo } from '#lib/countdown.js';
import {
  NOTIFICATION_TYPES,
  type AppNotification,
  type NotificationType,
} from '#lib/types/notification.js';

export function isNotificationType(value: unknown): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly unknown[]).includes(value);
}

/** What a notification says: who or what it's about, then what happened */
export type NotificationText = {
  /** A title, a person, or what was removed */
  title: string;
  /** What happened, as "Episode 7 aired" or "Liked your activity" */
  summary: string;
};

export function describeNotification(notification: AppNotification): NotificationText {
  const { actor, media, subject } = notification;
  const who = actor?.name ?? 'Someone';
  const title = (fallback: string) => media?.title ?? fallback;
  const thread = subject ?? 'a forum thread';

  switch (notification.type) {
    case 'AIRING':
      return {
        title: title('An anime'),
        summary: notification.episode
          ? `Episode ${notification.episode} aired`
          : 'A new episode aired',
      };
    case 'FOLLOWING':
      return { title: who, summary: 'Followed you' };
    case 'ACTIVITY_MESSAGE':
      return { title: who, summary: 'Sent you a message' };
    case 'ACTIVITY_MENTION':
      return { title: who, summary: 'Mentioned you in an activity' };
    case 'ACTIVITY_REPLY':
      return { title: who, summary: 'Replied to your activity' };
    case 'ACTIVITY_REPLY_SUBSCRIBED':
      // Also sent for activities followed without replying, so it doesn't say the viewer replied
      return { title: who, summary: "Replied to an activity you're subscribed to" };
    case 'ACTIVITY_LIKE':
      return { title: who, summary: 'Liked your activity' };
    case 'ACTIVITY_REPLY_LIKE':
      return { title: who, summary: 'Liked your reply' };
    case 'THREAD_COMMENT_MENTION':
      return { title: who, summary: `Mentioned you in ${thread}` };
    case 'THREAD_SUBSCRIBED':
      return { title: who, summary: `Commented in ${thread}` };
    case 'THREAD_COMMENT_REPLY':
      return { title: who, summary: `Replied to your comment in ${thread}` };
    case 'THREAD_COMMENT_LIKE':
      return { title: who, summary: `Liked your comment in ${thread}` };
    case 'THREAD_LIKE':
      return {
        title: who,
        summary: subject ? `Liked your thread ${subject}` : 'Liked your forum thread',
      };
    case 'RELATED_MEDIA_ADDITION':
      return {
        title: title('A title related to your list'),
        summary: 'New on AniList, related to your list',
      };
    case 'MEDIA_DATA_CHANGE':
      return { title: title('A title on your list'), summary: 'Updated on AniList' };
    case 'MEDIA_MERGE':
      return {
        title: title('A title on your list'),
        summary: subject ? `Merged with ${subject}` : 'Merged with another entry',
      };
    case 'MEDIA_DELETION':
      return { title: subject ?? 'A title on your list', summary: 'Removed from AniList' };
    case 'MEDIA_SUBMISSION_UPDATE':
    case 'STAFF_SUBMISSION_UPDATE':
    case 'CHARACTER_SUBMISSION_UPDATE':
      return subject
        ? { title: subject, summary: 'Your submission was reviewed' }
        : { title: 'Your submission', summary: 'Reviewed on AniList' };
  }
}

/** The days notifications are grouped under, newest first */
export type NotificationDay = 'Today' | 'Yesterday' | 'This week' | 'Earlier';
const DAYS: readonly NotificationDay[] = ['Today', 'Yesterday', 'This week', 'Earlier'];

/**
 * Notifications under the day they came: today, yesterday, the rest of the last week, then
 * everything older, in the viewer's own time zone. Each day comes once and in that order, keeping
 * the order AniList sent within it, even when one arrives out of order
 */
export function groupByDay<T extends { createdAt: number }>(
  notifications: readonly T[],
  now: number
): { day: NotificationDay; notifications: T[] }[] {
  const byDay = new Map<NotificationDay, T[]>();
  for (const notification of notifications) {
    const days = daysAgo(notification.createdAt, now);
    const day: NotificationDay =
      days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Earlier';
    const group = byDay.get(day);
    if (group) group.push(notification);
    else byDay.set(day, [notification]);
  }
  return DAYS.flatMap((day) => {
    const group = byDay.get(day);
    return group ? [{ day, notifications: group }] : [];
  });
}

/**
 * How long the dropdown shows what it loaded when opened again, rather than asking AniList again:
 * every visitor shares the app's AniList budget
 */
export const REUSE_NOTIFICATIONS_FOR_MS = 5 * 60_000;

/**
 * Whether opening the dropdown can show what it already has: the newest ones loaded, a little while
 * ago, with nothing new on the bell since
 */
export function reusesNotifications({
  loaded,
  loadedAt,
  bellUnread,
  now,
}: {
  /** The newest ones loaded without a problem */
  loaded: boolean;
  loadedAt: number;
  bellUnread: number;
  now: number;
}): boolean {
  return loaded && bellUnread === 0 && now - loadedAt < REUSE_NOTIFICATIONS_FOR_MS;
}

/**
 * How many of the newest were unread before the read that marked them read. AniList's own count, from
 * that same read, is the fresher one. When it says none, AniList may have counted after clearing
 * them, so the bell's last count stands in
 */
export function unreadBeforeRead(fromAniList: number | undefined, fromBell: number): number {
  return fromAniList ? fromAniList : fromBell;
}

/** The line under a notification: how a submission went, and why a title changed */
export function notificationDetail(notification: AppNotification): string | null {
  const status = notification.status?.replaceAll('_', ' ').trim().toLowerCase();
  const parts = [
    status ? status[0].toUpperCase() + status.slice(1) : '',
    notification.reason?.trim() ?? '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The count on the bell, kept to three characters */
export function unreadBadgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}
