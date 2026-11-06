import type { ScoreFormat } from '#lib/score.js';
import type { Domain } from '#lib/types/domain.js';

/** An anime's ids on each service */
export type AnimeIds = {
  /** AniList's; null on a MyAnimeList list, which only knows its own */
  id: number | null;
  /** MyAnimeList's; null when AniList doesn't know it, as for anime MyAnimeList doesn't have */
  malId: number | null;
};

/** An anime on someone's list, with what's needed to show it */
export type ListedAnime = AnimeIds & {
  title: string;
  coverUrl: string | null;
  /** Marked as adult (18+) */
  isAdult: boolean;
  /**
   * The average of all users' scores on the list's service, out of 100; null until enough have
   * scored it
   */
  meanScore: number | null;
};

/** An anime someone has scored */
export type ScoredAnime = ListedAnime & {
  /** Their score, in their own score format */
  score: number;
  /** The same score out of 100, to compare it with someone else's */
  score100: number;
};

/**
 * What someone thinks of the anime on their public list, to compare with someone else's. Anime
 * they've scored or plan to watch come with titles and covers, to show them; the others they have
 * seen are only ids
 */
export type TasteProfile = {
  domain: Domain;
  /** Their AniList user id; null on MyAnimeList, which doesn't say whose list it is */
  id: number | null;
  /** Their name, as AniList spells it, or as it was asked for on MyAnimeList */
  name: string;
  avatarUrl: string | null;
  /** How they score anime, which `score` is in */
  scoreFormat: ScoreFormat;
  scored: ScoredAnime[];
  /** The other anime they've watched some or all of, dropped ones included */
  seen: AnimeIds[];
  /** The anime they plan to watch, once they've started airing */
  planned: ListedAnime[];
};

/** An anime both have scored, with each one's score in their own format */
export type ScoredByBoth = { anime: ScoredAnime; a: number; b: number };

/** An anime one of them scored above their average and the other hasn't watched */
export type MatchPick = {
  anime: ScoredAnime;
  /** On the other one's plan list already */
  planned: boolean;
};

/** How two people's anime tastes compare: `a` and `b` are the two people, in the order compared */
export type TasteMatch = {
  /**
   * How alike their scores are, from 0 to 100, 50 being as alike as two strangers'; null when they
   * have scored too few of the same anime to tell
   */
  percent: number | null;
  /** How many anime both have watched some or all of */
  inCommon: number;
  /** How many of those both have scored, which `percent` is drawn from */
  bothScored: number;
  /** Anime both scored above their own average, the ones both liked most first */
  bothLoved: ScoredByBoth[];
  /** Anime their scores are furthest apart on, the furthest first */
  disagreements: ScoredByBoth[];
  /** Anime `b` scored above their average that `a` hasn't watched, `b`'s favorites first */
  picksForA: MatchPick[];
  /** The same, from `a` for `b` */
  picksForB: MatchPick[];
};
