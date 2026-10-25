/** Airing status, as AniList reports it */
export type AiringStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';

export type Anime = {
  id: number;
  title: string;
  /** The English title and other names the anime goes by, besides `title` */
  otherTitles: string[];
  thumbnailUrl: string;
  status: AiringStatus;
  /** Marked as adult (18+) on AniList */
  isAdult: boolean;
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
  numberAiredEpisodes: number | null;
  endDate: Date;
  numberEpisodes: number;
};
