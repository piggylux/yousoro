import type { SessionUser } from '#lib/types/session-user.js';

/** AniList's kinds of notification, as its API names them */
export const NOTIFICATION_TYPES = [
  'AIRING',
  'ACTIVITY_MESSAGE',
  'ACTIVITY_MENTION',
  'ACTIVITY_REPLY',
  'ACTIVITY_REPLY_SUBSCRIBED',
  'ACTIVITY_LIKE',
  'ACTIVITY_REPLY_LIKE',
  'THREAD_COMMENT_MENTION',
  'THREAD_SUBSCRIBED',
  'THREAD_COMMENT_REPLY',
  'THREAD_COMMENT_LIKE',
  'THREAD_LIKE',
  'FOLLOWING',
  'RELATED_MEDIA_ADDITION',
  'MEDIA_DATA_CHANGE',
  'MEDIA_MERGE',
  'MEDIA_DELETION',
  'MEDIA_SUBMISSION_UPDATE',
  'STAFF_SUBMISSION_UPDATE',
  'CHARACTER_SUBMISSION_UPDATE',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The anime or manga a notification is about */
export type NotificationMedia = {
  id: number;
  title: string | null;
  coverUrl: string | null;
  isAdult: boolean;
};

/** One AniList notification, trimmed to what the list shows */
export type AppNotification = {
  id: number;
  type: NotificationType;
  /** When AniList sent it, in milliseconds */
  createdAt: number;
  /** Where it leads: a page on AniList, or a list here; null when there's nothing to open */
  href: string | null;
  /** Who did it: who followed, liked, replied or mentioned */
  actor?: SessionUser | null;
  media?: NotificationMedia | null;
  /** The episode that aired */
  episode?: number;
  /** What else it names: a forum thread, removed titles, or what a submission was for */
  subject?: string | null;
  /** How a submission was reviewed, as AniList words it */
  status?: string | null;
  /** AniList's explanation of a change to an anime or manga, or a moderator's note */
  reason?: string | null;
};

export type NotificationsPage = {
  notifications: AppNotification[];
  hasNextPage: boolean;
  /** How many were unread before this read marked them read; only when it did */
  unread?: number;
};
