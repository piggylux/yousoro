import type { Domain } from '#lib/types/domain.js';

/** Airing status, as AniList reports it */
export type AiringStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';

export type Anime = {
  /** AniList's id, which every list uses, whichever service it's on */
  id: number;
  /** The same anime's id on MyAnimeList, when known */
  malId: number | null;
  title: string;
  /** The English title, when AniList has one */
  englishTitle: string | null;
  /** Other names the anime goes by, in any language, besides `title` and `englishTitle` */
  otherTitles: string[];
  thumbnailUrl: string;
  status: AiringStatus;
  /** Marked as adult (18+) on AniList */
  isAdult: boolean;
  /** The average of all AniList users' scores, out of 100; null until enough have scored it */
  meanScore: number | null;
  /** The list owner's score, in their own score format; null when they haven't scored it */
  userScore: number | null;
  currentEpisode: number;
  /** On the user's "Rewatching" list rather than "Watching"; `currentEpisode` is then the rewatch's */
  rewatching: boolean;
  /**
   * When the user last changed this anime on their list, as Unix time in ms. Usually that's their
   * progress, but AniList also counts other edits such as the score.
   */
  lastUpdatedAt: number | null;
  /** The next episode to air and when, as Unix time in ms; null when none is scheduled */
  nextEpisode: { number: number; airsAt: number } | null;
  /**
   * When the latest episode aired, as Unix time in ms, when that was recent enough to count as new
   * as the list loaded (see NEW_EPISODE_MS); null otherwise, or when it isn't known
   */
  recentEpisodeAiredAt: number | null;
  numberAiredEpisodes: number | null;
  endDate: Date;
  numberEpisodes: number;
  /**
   * On a list that combines the owner's AniList and MyAnimeList accounts, the one service whose
   * Watching list has the anime; unset when both have it, and on any other list
   */
  onlyOn?: Domain;
};

/**
 * An anime on someone's "Planning" list (AniList) or "Plan to Watch" list (MyAnimeList). Only what
 * a poster and its details need: these lists run to hundreds of anime, all read at once
 */
export type PlannedAnime = {
  /**
   * AniList's id; null on a MyAnimeList list, as matching a whole plan list to AniList would cost
   * a request per 50 anime
   */
  id: number | null;
  malId: number | null;
  title: string;
  englishTitle: string | null;
  coverUrl: string | null;
  isAdult: boolean;
  status: AiringStatus;
  /** How many episodes it has or will have; null until that's known */
  episodes: number | null;
  /** The average of all users' scores, out of 100; null until enough have scored it */
  meanScore: number | null;
  /** The year it started airing; null when that's unknown */
  year: number | null;
  /** As the list's service names them, which differ between AniList and MyAnimeList */
  genres: string[];
  /**
   * The anime this one continues that are on the same list and started airing before it, by
   * AniList's id: the page puts it after them in their series, and offers to start it once they
   * are. Airing order rather than story order, as a prequel made later, such as Fate/Zero, is
   * watched after what it precedes. Always empty on a MyAnimeList list, which has no AniList ids
   */
  prequels: number[];
  /**
   * The anime that continue this one but aren't listed on the page, so it can say what comes
   * after it: not planned, or not aired yet. Always empty on a MyAnimeList list, like `prequels`
   */
  sequels: PlannedSequel[];
  /** On a combined plan list, the one service whose plan list has the anime, as on `Anime` */
  onlyOn?: Domain;
};

/** A sequel of a planned anime that isn't listed: only what the plan list's single read gives */
export type PlannedSequel = {
  /** AniList's id */
  id: number;
  title: string;
  status: AiringStatus;
  /** On the plan list, only not aired yet, so it's counted rather than listed */
  planned: boolean;
};
