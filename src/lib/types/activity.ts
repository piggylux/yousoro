import type { NotificationMedia } from '#lib/types/notification.js';
import type { SessionUser } from '#lib/types/session-user.js';

/** An update someone the viewer follows made to their anime list on AniList */
export type FriendActivity = {
  id: number;
  /** When it happened, in milliseconds */
  createdAt: number;
  /** The activity on AniList, where it can be liked and replied to */
  href: string;
  user: SessionUser;
  media: NotificationMedia;
  /** What they did, as AniList words it: "watched episode", "completed", "plans to watch" */
  status: string;
  /** The episodes it covers, as "7" or "3 - 5", when it's about episodes */
  progress: string | null;
  likes: number;
  replies: number;
};

export type ActivityPage = {
  activities: FriendActivity[];
  hasNextPage: boolean;
};
