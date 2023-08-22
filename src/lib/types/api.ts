import type { Anime } from '$lib/types/anime';
import type { Domain } from '$lib/types/domain';
import type Anilist from 'anilist-node';

export interface Api {
  apiUrl: string;
  anilistSecret: string;
  malSecret?: string;

  anilist: Anilist;

  getAnimeList: (username: string) => Promise<Anime[]>;
}

export type AnimePageData = {
  domain: Domain;
  username: string;
  watchingList: Anime[];
  userProfileLink: string;
};
