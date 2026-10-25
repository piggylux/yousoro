import { getAiredEpisodes, getWatchingEntries } from '#lib/server/anilist-client.js';
import type { Api, UserAnimeList } from '#lib/types/api.js';

export class AniListApi implements Api {
  /** The signed-in user's token, so their own private entries are visible to them */
  constructor(private token?: string) {}

  async getUserAnimeList(username: string): Promise<UserAnimeList> {
    const { userId, userName, avatarUrl, entries } = await getWatchingEntries(username, this.token);

    return {
      userId,
      username: userName,
      avatarUrl,
      animeList: entries.map(({ media, status, progress, updatedAt }) => ({
        id: media.id,
        title: media.title.romaji,
        otherTitles: [media.title.english, ...(media.synonyms ?? [])].filter(
          (title): title is string => !!title && title !== media.title.romaji
        ),
        thumbnailUrl: media.coverImage.extraLarge,
        status: media.status,
        isAdult: media.isAdult,
        currentEpisode: progress,
        rewatching: status === 'REPEATING',
        lastUpdatedAt: updatedAt ? updatedAt * 1000 : null,
        nextEpisode: media.nextAiringEpisode
          ? {
              number: media.nextAiringEpisode.episode,
              airsAt: media.nextAiringEpisode.airingAt * 1000,
            }
          : null,
        numberAiredEpisodes: getAiredEpisodes(media),
        numberEpisodes: media.episodes ?? 0,
        endDate: new Date(`${media.endDate.year}-${media.endDate.month}-${media.endDate.day}`),
      })),
    };
  }
}
