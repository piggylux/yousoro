import type { Anime } from '#lib/types/anime.js';

/** Aired episodes the user hasn't watched yet, or 0 when they're caught up or it isn't known. */
export function getEpisodesToWatch(anime: Anime): number {
  return anime.numberAiredEpisodes
    ? Math.max(0, anime.numberAiredEpisodes - anime.currentEpisode)
    : 0;
}

/** How long after it airs an episode counts as new: a day, and some slack for time zones */
export const NEW_EPISODE_MS = 36 * 60 * 60 * 1000;

/** From this many episodes behind, a backlog gets the deeper badge */
export const BIG_BACKLOG = 10;

/**
 * Whether the anime could have a new episode for the user: a recent one they haven't watched.
 * Rewatches don't count: their episodes aren't new
 */
export function mayHaveNewEpisode(anime: Anime): boolean {
  return !anime.rewatching && anime.recentEpisodeAiredAt !== null && getEpisodesToWatch(anime) > 0;
}

/** Whether an episode the user hasn't watched yet aired just now (within NEW_EPISODE_MS) */
export function hasNewEpisode(anime: Anime, now: number): boolean {
  const airedAt = anime.recentEpisodeAiredAt;
  return (
    mayHaveNewEpisode(anime) &&
    airedAt !== null &&
    airedAt <= now &&
    now - airedAt <= NEW_EPISODE_MS
  );
}

/** What the user can do next with an anime, shown as its badge and used to sort the list. */
export type WatchState =
  | 'to-watch'
  | 'completed'
  | 'caught-up'
  // No aired count is known for the states below
  | 'next-episode-unscheduled'
  | 'hiatus'
  | 'not-aired'
  | 'cancelled'
  | 'unknown';

export function getWatchState(anime: Anime): WatchState {
  // Both services report 0 episodes while the total isn't known yet
  if (anime.numberEpisodes && anime.currentEpisode >= anime.numberEpisodes) return 'completed';
  if (getEpisodesToWatch(anime) > 0) return 'to-watch';
  if (anime.numberAiredEpisodes) return 'caught-up';

  switch (anime.status) {
    case 'RELEASING':
      return 'next-episode-unscheduled';
    case 'HIATUS':
      return 'hiatus';
    case 'NOT_YET_RELEASED':
      return 'not-aired';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

/**
 * Lower comes first: new episodes to watch, then rewatches, which can wait as every episode has
 * aired, then caught up or completed, then those without episode info
 */
function getSortGroup(anime: Anime): number {
  switch (getWatchState(anime)) {
    case 'to-watch':
      return anime.rewatching ? 1 : 0;
    case 'completed':
    case 'caught-up':
      return 2;
    default:
      return 3;
  }
}

/**
 * Anime with new episodes to watch first: those whose episode just aired, the newest airing first,
 * then the others. Then rewatches. Otherwise the ones the user updated most recently come first,
 * since those are what they're actively watching. Then caught-up anime, the next
 * episode to air first. Then anime with no episode info. Anime in the same place keep their
 * original order.
 */
export function sortWatchingList(animeList: Anime[]): Anime[] {
  return animeList.toSorted((a, b) => {
    const groupA = getSortGroup(a);
    const groupB = getSortGroup(b);
    if (groupA !== groupB) return groupA - groupB;
    if (groupA === 0) {
      // Whether an episode aired recently is as of when the list loaded, so the order doesn't
      // change while the viewer looks at it
      const airedA = a.recentEpisodeAiredAt ?? 0;
      const airedB = b.recentEpisodeAiredAt ?? 0;
      if (airedA !== airedB) return airedB - airedA;
    }
    // Within a group, anime with no update time or no scheduled episode go last
    if (groupA <= 1) return (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0);
    if (groupA === 2) {
      // `|| 0` because two unscheduled anime give Infinity - Infinity, which is NaN
      return (a.nextEpisode?.airsAt ?? Infinity) - (b.nextEpisode?.airsAt ?? Infinity) || 0;
    }
    return 0;
  });
}

/** The soonest scheduled episode across the whole list, or null when none is scheduled. */
export function getNextUp(
  animeList: Anime[]
): { anime: Anime; episode: number; airsAt: number } | null {
  let nextUp: { anime: Anime; episode: number; airsAt: number } | null = null;
  for (const anime of animeList) {
    if (anime.nextEpisode && (!nextUp || anime.nextEpisode.airsAt < nextUp.airsAt)) {
      nextUp = { anime, episode: anime.nextEpisode.number, airsAt: anime.nextEpisode.airsAt };
    }
  }
  return nextUp;
}

export type Backlog = {
  /** Unwatched aired episodes across the whole list */
  episodes: number;
  /** How many anime those episodes come from */
  anime: number;
  /** The anime with the most episodes left, the first one listed on a tie */
  biggest: { anime: Anime; episodes: number } | null;
};

/** The anime to list: all of them, or without those AniList marks as adult when they're hidden */
export function withoutHiddenMature(animeList: Anime[], showMature: boolean): Anime[] {
  return showMature ? animeList : animeList.filter((anime) => !anime.isAdult);
}

/**
 * New episodes the user has fallen behind on. Rewatches are left out: their episodes aired long
 * ago, and the user watches them at their own pace.
 */
export function getBacklog(animeList: Anime[]): Backlog {
  const backlog: Backlog = { episodes: 0, anime: 0, biggest: null };
  for (const anime of animeList) {
    if (anime.rewatching) continue;
    const episodes = getEpisodesToWatch(anime);
    if (episodes > 0) {
      backlog.episodes += episodes;
      backlog.anime += 1;
      if (!backlog.biggest || episodes > backlog.biggest.episodes) {
        backlog.biggest = { anime, episodes };
      }
    }
  }
  return backlog;
}
