import { recordOwnWatchingEntry } from '#lib/friend-watching.js';
import { expireRememberedList } from '#lib/list-data.js';
import { forgetPlanned, markStarted } from '#lib/planning.js';
import { forgetSeasonTaste, rememberTasteMove } from '#lib/season-taste.js';
import type { ListMove } from '#lib/types/api.js';
import type { Domain } from '#lib/types/domain.js';
import type { SessionUser } from '#lib/types/session-user.js';

/** An anime that moved on a list, as the pages that remember lists show it */
export type MovedAnime = {
  /** AniList's id; null for an anime only known on MyAnimeList */
  id: number | null;
  malId: number | null;
  title: string;
  isAdult: boolean;
  coverUrl: string | null;
};

/**
 * Forgets everything this tab remembers of a list, after a change it can't follow in detail, as a
 * revert from the history: the Watching list, the plan list and the season page's taste are read
 * again the next time they're shown
 */
export function forgetRememberedLists(domain: Domain, username: string) {
  expireRememberedList(username, domain);
  forgetPlanned(domain, username);
  forgetSeasonTaste(domain, username);
}

/**
 * Tells what this tab remembers of a list that an anime moved on it, from a page other than the
 * Watching list itself: started, planned, or an add undone. Plan lists the tab remembers lose a
 * started anime or are read again, the season page's taste moves it or is read again, the
 * Watching list is read again, and the friends pages learn whether the owner watches it now.
 * `friendsViewer` is the signed-in AniList user when the list is theirs, whose watching the
 * friends pages show
 */
export function noteListMove(
  {
    domain,
    username,
    friendsViewer,
  }: { domain: Domain; username: string; friendsViewer: SessionUser | null },
  anime: MovedAnime,
  { list, progress = 0, undone = false }: { list: ListMove; progress?: number; undone?: boolean }
) {
  // An undone add went back to wherever it was, which only reading the list again tells
  const key = domain === 'anilist' ? anime.id : anime.malId;
  if (undone || key === null) forgetSeasonTaste(domain, username);
  else rememberTasteMove(domain, username, key, list);
  if (list === 'PLANNING' || undone) forgetPlanned(domain, username);
  if (list !== 'CURRENT') return;
  if (!undone) markStarted(domain, username, anime);
  expireRememberedList(username, domain);
  if (friendsViewer && anime.id !== null) {
    recordOwnWatchingEntry(
      friendsViewer,
      {
        id: anime.id,
        title: anime.title,
        isAdult: anime.isAdult,
        thumbnailUrl: anime.coverUrl ?? '',
        currentEpisode: undone ? 0 : progress,
        rewatching: false,
      },
      // Undone, it's no longer one they watch, wherever it went back to
      undone ? 'PLANNING' : 'CURRENT'
    );
  }
}
