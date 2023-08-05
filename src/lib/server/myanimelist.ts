import type { Anime } from '$lib/types/anime';
import type { Api } from '$lib/types/api';
import type { AiringEntry } from 'anilist-node';
import anilist from 'anilist-node';
import { RateLimit } from 'async-sema';

type AnimeListResponseData = {
  node: {
    id: number;
    title: string;
    main_picture: {
      medium: string;
      large: string;
    };
    num_episodes: number;
    end_date?: string | null;
  };
  list_status: {
    status: string;
    score: number;
    num_episodes_watched: number;
    is_rewatching: boolean;
    updated_at: string;
  };
};

export class MyAnimeListApi implements Api {
  apiUrl = 'https://api.myanimelist.net/v2';
  malSecret = import.meta.env.VITE_MAL_CLIENT_ID;
  anilistSecret = import.meta.env.VITE_ANILIST_TOKEN;

  anilist = new anilist(this.anilistSecret);
  rateLimit = RateLimit(3);

  async getAnimeList(username: string): Promise<Anime[]> {
    const animeList = await this.getWatchingList(username);
    const numberAiredEpisodes = await Promise.all(
      animeList.map((anime) => this.getAnimeNumberAiredEpisodes(anime.title))
    );

    return animeList.map((anime, index) => ({
      ...anime,
      numberAiredEpisodes: numberAiredEpisodes[index],
    }));
  }

  private async getWatchingList(username: string): Promise<Omit<Anime, 'numberAiredEpisodes'>[]> {
    const data: Anime[] = [];

    let response;
    let paging;
    let request = `${this.apiUrl}/users/${username}/animelist?&nsfw=true&fields=num_episodes,end_date,list_status&status=watching&limit=1000`;

    do {
      response = await fetch(request, {
        method: 'GET',
        headers: {
          'X-MAL-CLIENT-ID': this.malSecret,
        },
      });

      const responseBody = await response.json();
      paging = responseBody.paging;

      responseBody.data.map((animeData: AnimeListResponseData) =>
        data.push({
          id: animeData.node.id,
          title: animeData.node.title,
          thumbnailUrl: animeData.node.main_picture.large,
          currentEpisode: animeData.list_status.num_episodes_watched,
          endDate: animeData.node.end_date ? new Date(animeData.node.end_date) : null,
          numberEpisodes: animeData.node.num_episodes,
        } as Anime)
      );

      request = paging?.next;
    } while (request);

    return data;
  }

  private async getAnimeNumberAiredEpisodes(animeTitle: string): Promise<number | null> {
    try {
      await this.rateLimit();
      const response = await this.anilist.searchEntry.anime(animeTitle);

      if (!response.media.length) {
        return null;
      }

      await this.rateLimit();
      const anime = await this.anilist.media.anime(response.media[0].id);

      if (anime.status === 'FINISHED') {
        return anime.episodes;
      }

      if (anime.status === 'NOT_YET_RELEASED') {
        return null;
      }

      const airingEntry = anime.nextAiringEpisode as unknown as AiringEntry;

      return airingEntry.episode - 1;
    } catch (error) {
      console.error(error);
      return null;
    }
  }
}
