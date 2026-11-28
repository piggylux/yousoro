import type { FriendActivity } from '#lib/types/activity.js';

/**
 * What someone did, from AniList's wording: "Alice watched episode 7", "Alice watched episodes
 * 3–5", "Alice completed", "Alice plans to watch". Only an update about episodes says which ones,
 * as AniList sometimes keeps an old count on other updates
 */
export function describeActivity({
  user,
  status,
  progress,
}: Pick<FriendActivity, 'user' | 'status' | 'progress'>): string {
  let text = status.trim().replace(/\s+/g, ' ').toLowerCase();
  const episodes = progress?.trim();
  if (episodes && text.endsWith(' episode')) {
    // AniList joins a run of episodes into one update, as "3 - 5"
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(episodes);
    text = range ? `${text}s ${range[1]}–${range[2]}` : `${text} ${episodes}`;
  }
  return `${user.name} ${text}`;
}

/** How many liked and replied to it, leaving out what nobody did: "3 likes · 1 reply" */
export function activityReactions({
  likes,
  replies,
}: Pick<FriendActivity, 'likes' | 'replies'>): string | null {
  const parts = [
    likes ? `${likes} ${likes === 1 ? 'like' : 'likes'}` : '',
    replies ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * How long the dropdown shows what it loaded when opened again, rather than asking AniList again:
 * every visitor shares the app's AniList budget. Shorter than for notifications, as there's no
 * count like the bell's to say when there's something new
 */
export const REUSE_ACTIVITY_FOR_MS = 2 * 60_000;

/** Whether opening the dropdown again can show what it loaded at `loadedAt` */
export function reusesActivity(loadedAt: number, now: number): boolean {
  return now - loadedAt < REUSE_ACTIVITY_FOR_MS;
}
