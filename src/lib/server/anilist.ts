import type { Anime } from '$lib/types/anime';
import type { Api } from '$lib/types/api';
import anilist from 'anilist-node';
import type { AiringEntry, ListEntry } from 'anilist-node';
import { RateLimit } from 'async-sema';

export class AniListApi implements Api {
  malSecret?: string | undefined;
  apiUrl = '';
  anilistSecret = import.meta.env.VITE_ANILIST_TOKEN;

  anilist = new anilist(this.anilistSecret);
  rateLimit = RateLimit(3);

  async getAnimeList(username: string): Promise<Anime[]> {
    const animeList = await this.getWatchingList(username);
    const animeDetails = await Promise.all(
      animeList.map((anime) => this.getAnimeDetails(anime.title))
    );

    return animeList.map((anime, index) => ({
      ...anime,
      id: animeDetails[index]?.id ?? 0,
      numberAiredEpisodes: animeDetails[index]?.numberAiredEpisodes ?? 0,
      thumbnailUrl: animeDetails[index]?.thumbnailUrl ?? '',
    }));
  }

  async getWatchingList(
    username: string
  ): Promise<Omit<Anime, 'id' | 'numberAiredEpisodes' | 'thumbnailUrl'>[]> {
    const response = await this.anilist.lists.anime(username);
    const list: ListEntry[] = response.find((list) => list.status === 'CURRENT')?.entries ?? [];
    return Promise.resolve(
      list.map(({ media, progress }) => ({
        currentEpisode: progress,
        title: media.title.romaji,
        numberEpisodes: media.episodes ?? 0,
        endDate: new Date(`${media.endDate.year}-${media.endDate.month}-${media.endDate.day}`),
      }))
    );
  }

  private async getAnimeDetails(
    animeTitle: string
  ): Promise<Pick<Anime, 'id' | 'numberAiredEpisodes' | 'thumbnailUrl'> | null> {
    try {
      await this.rateLimit();
      const response = await this.anilist.searchEntry.anime(animeTitle);

      if (!response.media.length) {
        return null;
      }

      await this.rateLimit();
      const anime = await this.anilist.media.anime(response.media[0].id);

      if (anime.status === 'FINISHED') {
        return {
          id: anime.id,
          numberAiredEpisodes: anime.episodes,
          thumbnailUrl: anime.coverImage.large,
        };
      }

      if (anime.status === 'NOT_YET_RELEASED') {
        return null;
      }

      const airingEntry = anime.nextAiringEpisode as unknown as AiringEntry;

      return {
        id: anime.id,
        numberAiredEpisodes: airingEntry.episode - 1,
        thumbnailUrl: anime.coverImage.large,
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }
}
