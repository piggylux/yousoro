import type { ScoreFormat } from '#lib/score.js';

/** An anime on someone's list, with what's needed to show it */
export type ListedAnime = {
  id: number;
  title: string;
  coverUrl: string | null;
  /** Marked as adult (18+) on AniList */
  isAdult: boolean;
  /** The average of all AniList users' scores, out of 100; null until enough have scored it */
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
 * What someone thinks of the anime on their public AniList list, to compare with someone else's.
 * Anime they've scored or plan to watch come with titles and covers, to show them; the others they
 * have seen are only ids
 */
export type TasteProfile = {
  id: number;
  /** Their name, as AniList spells it */
  name: string;
  avatarUrl: string | null;
  /** How they score anime, which `score` is in */
  scoreFormat: ScoreFormat;
  scored: ScoredAnime[];
  /** The other anime they've watched some or all of, dropped ones included */
  seen: number[];
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
