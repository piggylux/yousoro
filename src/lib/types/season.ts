import type { ListedIds } from '#lib/types/api.js';
import type { Domain } from '#lib/types/domain.js';

/** What a trait of an anime is: a genre, one of AniList's tags (themes and the like), or a studio */
export type TraitKind = 'genre' | 'tag' | 'studio';

/** How one genre, tag or studio fares on someone's list */
export type TasteTrait = {
  kind: TraitKind;
  /** As AniList names it */
  name: string;
  /** How many anime with it they have on their lists, planned ones aside */
  count: number;
  /**
   * How much higher than their own average they score anime with it, in standard deviations of
   * their scores, so it means the same whatever their score format; null when they scored none
   */
  lift: number | null;
};

/**
 * What the season page knows of a list owner's taste and lists, from one read of their list: the
 * anime on it by AniList id on AniList, by MyAnimeList id on MyAnimeList
 */
export type SeasonTaste = {
  /** How many anime they've scored */
  scored: number;
  /** How many anime they have on their lists, planned ones aside */
  watched: number;
  traits: TasteTrait[];
  /** The anime on each of their lists besides Watching and Rewatching */
  listedIds: ListedIds;
  /** The anime on their Watching and Rewatching lists, with how far they are */
  watching: { id: number; progress: number; rewatching: boolean }[];
  /** Their scores out of 100, by anime; unscored anime are left out */
  scores: [id: number, score100: number][];
  /** Their average score out of 100; null when they've scored nothing */
  mean100: number | null;
};

export type SeasonTastePageData = SeasonTaste & {
  domain: Domain;
  /** As the service spells it */
  username: string;
  /** Whether the signed-in user owns this list and can add to it */
  canEdit: boolean;
};
