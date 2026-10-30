import type { ListSection } from '#lib/anime.js';
import type { ScoreFormat } from '#lib/score.js';
import type { Anime } from '#lib/types/anime.js';
import type { Domain } from '#lib/types/domain.js';
import type { Preferences } from '#lib/types/preferences.js';

export type UserAnimeList = {
  /** The service's id for the list owner, when the service provides it */
  userId: number | null;
  /** The username as the service spells it, which may differ in case from the one requested */
  username: string;
  avatarUrl: string | null;
  /** How the list owner scores anime, which the anime's `userScore` is in */
  scoreFormat: ScoreFormat;
  animeList: Anime[];
  /** Anime on a MyAnimeList list that AniList doesn't know, so they can't be shown as cards */
  unmatched?: UnmatchedAnime[];
};

/** A save that reached the list's service but not the account linked to it */
export type LinkedFailure = {
  /** What was saved where, and why the linked account wasn't updated */
  message: string;
  /** Whether saving again may help, as when the service was busy */
  retry: boolean;
};

export type UnmatchedAnime = {
  malId: number;
  title: string;
  /** Marked as adult on MyAnimeList, so it's hidden with the cards AniList marks so */
  isAdult: boolean;
};

export interface Api {
  getUserAnimeList: (username: string) => Promise<UserAnimeList>;
}

export type AnimePageData = {
  /** Calendar reads omit the optional recent-airing badge lookup. */
  airingsEnriched?: boolean;
  retryAt?: number;
  domain: Domain;
  username: string;
  avatarUrl: string | null;
  /** Whether the signed-in user owns this list and can update its progress */
  canEdit: boolean;
  watchingList: Anime[];
  /** How the list owner scores anime */
  scoreFormat: ScoreFormat;
  /** The sections of the list the viewer hides with the filters above it */
  hiddenSections: ListSection[];
  userProfileLink: string;
  unmatched?: UnmatchedAnime[];
  /** The viewer's display settings, from the root layout */
  preferences: Preferences;
};
