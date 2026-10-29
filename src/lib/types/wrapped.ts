import type { ScoreFormat } from '#lib/score.js';
import type { ListedAnime } from '#lib/types/match.js';

/** An anime someone finished in a year, with what's needed to sum up their year */
export type FinishedAnime = ListedAnime & {
  /** Their score, in their own score format; 0 when they haven't scored it */
  score: number;
  /** The same score out of 100; null when they haven't scored it */
  score100: number | null;
  /** Episodes they watched */
  episodes: number;
  /** How long those took, in minutes */
  minutes: number;
  /** The month they finished it, from 1 to 12; null when AniList only knows the year */
  month: number | null;
  genres: string[];
};

/** The anime someone finished in a year, from their public AniList list */
export type AnimeYear = {
  id: number;
  name: string;
  avatarUrl: string | null;
  scoreFormat: ScoreFormat;
  year: number;
  finished: FinishedAnime[];
};
