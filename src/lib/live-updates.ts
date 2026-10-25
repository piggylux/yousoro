import type { Anime } from '#lib/types/anime.js';

/** How long after an episode's scheduled time the list reloads, so AniList has moved on to the next */
export const AIRING_SLACK_MS = 60 * 1000;

// The longest delay setTimeout can wait; anything longer fires at once
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * How long to wait before reloading the list to show the next episode that airs, in ms; null when
 * no episode is scheduled. An episode whose time has passed by more than AIRING_SLACK_MS is left
 * out: the list already reloaded for it, and AniList hasn't caught up, so reloading again won't
 * help until the next one airs
 */
export function nextAiringReloadDelay(animeList: Anime[], now: number): number | null {
  let soonest: number | null = null;
  for (const { nextEpisode } of animeList) {
    if (!nextEpisode || nextEpisode.airsAt <= now - AIRING_SLACK_MS) continue;
    if (soonest === null || nextEpisode.airsAt < soonest) soonest = nextEpisode.airsAt;
  }
  if (soonest === null) return null;
  return Math.min(Math.max(soonest - now, 0) + AIRING_SLACK_MS, MAX_TIMEOUT_MS);
}

/** Coming back to the tab after this long reloads the list, to show changes made elsewhere */
export const RETURN_RELOAD_AFTER_MS = 5 * 60 * 1000;

/**
 * What to do when it's time to reload: reload now, wait for the tab to be visible again, as a
 * hidden tab doesn't reload, or try again later, while the viewer is busy on the page (a card
 * turned over, where a reload would throw away what they're typing, or the score prompt open)
 */
export function planReload({
  hidden,
  busy,
}: {
  hidden: boolean;
  busy: boolean;
}): 'now' | 'when-visible' | 'later' {
  if (hidden) return 'when-visible';
  return busy ? 'later' : 'now';
}

/**
 * Whether coming back to the tab reloads the list: when a reload waited for it, or when the list
 * loaded long enough ago (RETURN_RELOAD_AFTER_MS) that it may have changed elsewhere
 */
export function reloadsOnReturn({
  waiting,
  loadedAt,
  now,
}: {
  waiting: boolean;
  loadedAt: number;
  now: number;
}): boolean {
  return waiting || now - loadedAt > RETURN_RELOAD_AFTER_MS;
}
