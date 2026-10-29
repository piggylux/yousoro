import { NEW_EPISODE_MS } from '#lib/anime.js';
import {
  getAiredEpisodes,
  getLatestAirings,
  getWatchingEntries,
  type AniListEntry,
} from '#lib/server/anilist-client.js';
import type { AniListPriority } from '#lib/server/rate-limit.js';
import type { Api, UserAnimeList } from '#lib/types/api.js';

export class AniListApi implements Api {
  /** The signed-in user's token, so their own private entries are visible to them */
  constructor(private token?: string) {}

  async getUserAnimeList(
    username: string,
    enrichAirings = true,
    priority?: AniListPriority
  ): Promise<UserAnimeList> {
    const { userId, userName, avatarUrl, scoreFormat, entries } = await getWatchingEntries(
      username,
      this.token,
      priority
    );

    const recentAirings = enrichAirings
      ? await getRecentAirings(entries)
      : new Map<number, number>();

    return {
      userId,
      username: userName,
      avatarUrl,
      scoreFormat,
      animeList: entries.map(({ media, status, progress, score, updatedAt }) => ({
        id: media.id,
        title: media.title.romaji,
        englishTitle: media.title.english,
        otherTitles: (media.synonyms ?? []).filter(
          (title) => title !== media.title.romaji && title !== media.title.english
        ),
        thumbnailUrl: media.coverImage.extraLarge,
        status: media.status,
        isAdult: media.isAdult,
        meanScore: media.meanScore,
        userScore: score || null,
        currentEpisode: progress,
        rewatching: status === 'REPEATING',
        lastUpdatedAt: updatedAt ? updatedAt * 1000 : null,
        nextEpisode: media.nextAiringEpisode
          ? {
              number: media.nextAiringEpisode.episode,
              airsAt: media.nextAiringEpisode.airingAt * 1000,
            }
          : null,
        recentEpisodeAiredAt: (recentAirings.get(media.id) ?? 0) * 1000 || null,
        numberAiredEpisodes: getAiredEpisodes(media),
        numberEpisodes: media.episodes ?? 0,
        endDate: new Date(`${media.endDate.year}-${media.endDate.month}-${media.endDate.day}`),
      })),
    };
  }
}

/**
 * When each anime that may have a new episode aired its latest one, by AniList id, as Unix time in
 * seconds: only anime on "Watching" with an aired episode the user hasn't watched, and only airings
 * recent enough to count as new. It only decides the "New" badge, so the list still shows without
 * it when AniList fails to answer
 */
async function getRecentAirings(entries: AniListEntry[]): Promise<Map<number, number>> {
  const mediaIds = entries
    .filter(
      ({ status, progress, media }) =>
        status === 'CURRENT' && (getAiredEpisodes(media) ?? 0) > progress
    )
    .map(({ media }) => media.id);
  if (mediaIds.length === 0) return new Map();
  try {
    return await getLatestAirings(mediaIds, Math.floor((Date.now() - NEW_EPISODE_MS) / 1000));
  } catch (error) {
    console.error('Could not get recent airings from AniList', error);
    return new Map();
  }
}
