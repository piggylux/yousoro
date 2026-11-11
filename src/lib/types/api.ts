import type { ListSection } from '#lib/anime.js';
import type { ScoreFormat } from '#lib/score.js';
import type { Anime, PlannedAnime, PlannedSequel } from '#lib/types/anime.js';
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
  /** The anime on the owner's other lists, read along with their own AniList list */
  listedIds?: ListedIds;
};

/** The lists an anime can be on besides Watching and Rewatching, as AniList names them */
export const OTHER_LISTS = ['PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED'] as const;
export type OtherList = (typeof OTHER_LISTS)[number];

/**
 * The anime on each of the owner's other lists, so the anime search can say where those it finds
 * are: AniList ids on an AniList list, MyAnimeList ids on a MyAnimeList list. A list with nothing
 * on it may be left out
 */
export type ListedIds = Partial<Record<OtherList, number[]>>;

/** The lists an anime can be moved to on its own: "Watching" and "Planning", as AniList names them */
export type ListMove = 'CURRENT' | 'PLANNING';

/**
 * Where an anime was before it was added from the search, which undoing the add puts it back to:
 * not on the list, or on the plan, paused or dropped list it was moved from
 */
export type Before = 'NONE' | 'PLANNING' | 'PAUSED' | 'DROPPED';

export function isBefore(value: unknown): value is Before {
  return value === 'NONE' || value === 'PLANNING' || value === 'PAUSED' || value === 'DROPPED';
}

/** A list entry's dates, by AniList's names for them */
export type EntryDate = 'startedAt' | 'completedAt';

/**
 * What an entry held before a save finished the anime, which reverting the save puts back: how many
 * times it was watched again, and its dates, YYYY-MM-DD or less when partly unknown. `added` are
 * the dates the finish set that the entry didn't have, which reverting clears, there and on the
 * linked account the finish was copied to. Any other date was left as it was by the copy, so it
 * stays
 */
export type BeforeFinish = {
  rewatched: number;
  startedAt: string | null;
  completedAt: string | null;
  added: EntryDate[];
};

/** The dates a save set that an entry didn't have before it */
export function addedDates(
  before: Record<EntryDate, string | null>,
  after: Record<EntryDate, string | null>
): EntryDate[] {
  return (['startedAt', 'completedAt'] as const).filter((date) => !before[date] && after[date]);
}

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

/** Someone's "Planning" or "Plan to Watch" list */
export type PlannedList = {
  /** The service's id for the list owner, when the service provides it */
  userId: number | null;
  /** The username as the service spells it, which may differ in case from the one requested */
  username: string;
  /**
   * With when the user last changed each entry, usually as they planned it, as Unix time in ms,
   * when it started airing, every anime it continues and every anime that continues it. None of
   * the four is sent as it stands: they order the list and become its `prequels` and `sequels`,
   * which only the page can work out, once the list holds just the anime it shows
   */
  planned: (Omit<PlannedAnime, 'prequels' | 'sequels'> & {
    addedAt: number | null;
    /** The day it started airing, as a sortable YYYYMMDD number; null when that's unknown */
    startedOn: number | null;
    /** Every anime it continues, by AniList's id, before they're narrowed to this list */
    prequelIds: number[];
    /**
     * Every anime that continues it, before those the page lists are left out, and mature ones
     * when the viewer hides them
     */
    allSequels: (Omit<PlannedSequel, 'planned'> & { isAdult: boolean })[];
  })[];
};

export type PlanningPageData = {
  domain: Domain;
  username: string;
  /** Whether the signed-in user owns this list and can start watching its anime */
  canEdit: boolean;
  /** The planned anime that are out, most recently planned first */
  planned: PlannedAnime[];
  /** How many more haven't aired yet: nobody can start those, so they're only counted */
  upcoming: number;
  /** The list on its service */
  userProfileLink: string;
};

export interface Api {
  getUserAnimeList: (username: string) => Promise<UserAnimeList>;
  getPlannedAnime: (username: string) => Promise<PlannedList>;
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
  unmatched?: UnmatchedAnime[];
  /**
   * The anime on the owner's other lists, by AniList id, on their own AniList list only, so the
   * anime search can say where those it finds are. A MyAnimeList list asks as the search opens
   */
  listedIds?: ListedIds;
  /** The viewer's display settings, from the root layout */
  preferences: Preferences;
};
