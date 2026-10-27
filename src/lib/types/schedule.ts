export type ScheduledEpisode = { mediaId: number; episode: number; airsAt: number };
export type ScheduleResult = {
  episodes: ScheduledEpisode[];
  partial: boolean;
  partialReason?: 'limit' | 'unavailable';
  stale?: boolean;
  /** Timestamp of the oldest cached portion, in milliseconds. */
  fetchedAt?: number;
  /** Seconds until a rate-limited lookup may be retried. */
  retryAfter?: number;
};
