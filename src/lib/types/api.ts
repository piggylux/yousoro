import type { Anime } from '#lib/types/anime.js';
import type { Domain } from '#lib/types/domain.js';

export type UserAnimeList = {
  /** The service's id for the list owner, when the service provides it */
  userId: number | null;
  /** The username as the service spells it, which may differ in case from the one requested */
  username: string;
  avatarUrl: string | null;
  animeList: Anime[];
};

export interface Api {
  getUserAnimeList: (username: string) => Promise<UserAnimeList>;
}

export type AnimePageData = {
  domain: Domain;
  username: string;
  avatarUrl: string | null;
  /** Whether the signed-in user owns this list and can update its progress */
  canEdit: boolean;
  watchingList: Anime[];
  userProfileLink: string;
};
