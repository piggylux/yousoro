import type { Anime } from '#lib/types/anime.js';

/** Aired episodes the user hasn't watched yet, or 0 when they're caught up or it isn't known. */
export function getEpisodesToWatch(anime: Anime): number {
  return anime.numberAiredEpisodes
    ? Math.max(0, anime.numberAiredEpisodes - anime.currentEpisode)
    : 0;
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

/** Lower comes first: anime to watch, then caught up or completed, then those without episode info */
function getSortGroup(state: WatchState): number {
  switch (state) {
    case 'to-watch':
      return 0;
    case 'completed':
    case 'caught-up':
      return 1;
    default:
      return 2;
  }
}

/**
 * Anime with episodes to watch first, the ones the user updated most recently first, since those
 * are what they're actively watching. Then caught-up anime, the next episode to air first. Then
 * anime with no episode info. Anime in the same place keep their original order.
 */
export function sortWatchingList(animeList: Anime[]): Anime[] {
  return animeList.toSorted((a, b) => {
    const groupA = getSortGroup(getWatchState(a));
    const groupB = getSortGroup(getWatchState(b));
    if (groupA !== groupB) return groupA - groupB;
    // Within a group, anime with no update time or no scheduled episode go last
    if (groupA === 0) return (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0);
    if (groupA === 1) {
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

export function getBacklog(animeList: Anime[]): Backlog {
  const backlog: Backlog = { episodes: 0, anime: 0, biggest: null };
  for (const anime of animeList) {
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
