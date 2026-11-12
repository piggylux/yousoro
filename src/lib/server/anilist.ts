import { NEW_EPISODE_MS } from '#lib/anime.js';
import {
  getAiredEpisodes,
  getLatestAirings,
  getPlanningEntries,
  getSeasonTaste,
  getWatchingEntries,
  type AniListMedia,
  type AniListPlannedEntry,
} from '#lib/server/anilist-client.js';
import type { RequestPriority } from '#lib/server/rate-limit.js';
import type { Anime } from '#lib/types/anime.js';
import type { Api, PlannedList, TasteRead, UserAnimeList } from '#lib/types/api.js';

export class AniListApi implements Api {
  /** The signed-in user's token, so their own private entries are visible to them */
  constructor(private token?: string) {}

  /** With `withListed`, for the owner's own list, also the AniList ids on their other lists */
  async getUserAnimeList(
    username: string,
    enrichAirings = true,
    priority?: RequestPriority,
    withListed = false
  ): Promise<UserAnimeList> {
    const { userId, userName, avatarUrl, scoreFormat, entries, listedIds } =
      await getWatchingEntries(username, this.token, priority, withListed);

    const animeList = entries.map(({ media, status, progress, score, updatedAt }) =>
      toAnime(media, {
        progress,
        score,
        rewatching: status === 'REPEATING',
        updatedAt: updatedAt ? updatedAt * 1000 : null,
      })
    );

    return {
      userId,
      username: userName,
      avatarUrl,
      scoreFormat,
      animeList: enrichAirings ? await withRecentAirings(animeList) : animeList,
      ...(listedIds && { listedIds }),
    };
  }

  async getPlannedAnime(username: string): Promise<PlannedList> {
    const { userId, userName, entries } = await getPlanningEntries(username, this.token);
    return { userId, username: userName, planned: entries.map(toPlannedAnime) };
  }

  async getSeasonTaste(username: string): Promise<TasteRead> {
    const { userId, userName, taste } = await getSeasonTaste(username, this.token);
    return { userId, username: userName, taste };
  }
}

function toPlannedAnime({ media, updatedAt }: AniListPlannedEntry): PlannedList['planned'][number] {
  return {
    id: media.id,
    malId: media.idMal ?? null,
    title: media.title.romaji,
    englishTitle: media.title.english,
    coverUrl: media.coverImage?.medium ?? null,
    isAdult: media.isAdult,
    status: media.status,
    episodes: media.episodes ?? null,
    meanScore: media.meanScore,
    year: media.startDate?.year ?? null,
    genres: media.genres ?? [],
    addedAt: updatedAt ? updatedAt * 1000 : null,
    startedOn: startedOn(media.startDate),
    prequelIds: (media.relations?.edges ?? [])
      .filter(({ relationType }) => relationType === 'PREQUEL')
      .map(({ node }) => node.id),
    // Only sequels that are anime are kept, so every one is; one AniList links twice is shown once
    allSequels: (media.relations?.edges ?? [])
      .filter(
        ({ relationType, node }, index, edges) =>
          relationType === 'SEQUEL' &&
          edges.findIndex(
            (other) => other.relationType === 'SEQUEL' && other.node.id === node.id
          ) === index
      )
      .map(({ node }) => ({
        id: node.id,
        title: node.title?.romaji ?? '',
        isAdult: node.isAdult ?? false,
        // A sequel AniList gives no status for is most likely out already, as on MyAnimeList
        status: node.status ?? 'FINISHED',
      })),
  };
}

/**
 * An AniList start date as one number to compare, YYYYMMDD, with an unknown month or day as the
 * start of what is known. Null without a year, as there's then nothing to order it by
 */
export function startedOn(date: AniListPlannedEntry['media']['startDate']) {
  if (!date?.year) return null;
  return date.year * 10000 + (date.month ?? 0) * 100 + (date.day ?? 0);
}

/**
 * An anime on someone's list, from AniList's details of it and the list entry, whichever service
 * the list is on. `updatedAt` is Unix time in ms
 */
export function toAnime(
  media: AniListMedia,
  entry: { progress: number; score: number; rewatching: boolean; updatedAt: number | null }
): Anime {
  return {
    id: media.id,
    malId: media.idMal ?? null,
    title: media.title.romaji,
    englishTitle: media.title.english,
    otherTitles: (media.synonyms ?? []).filter(
      (title) => title !== media.title.romaji && title !== media.title.english
    ),
    thumbnailUrl: media.coverImage.extraLarge,
    status: media.status,
    isAdult: media.isAdult,
    meanScore: media.meanScore,
    userScore: entry.score || null,
    currentEpisode: entry.progress,
    rewatching: entry.rewatching,
    lastUpdatedAt: entry.updatedAt,
    nextEpisode: media.nextAiringEpisode
      ? {
          number: media.nextAiringEpisode.episode,
          airsAt: media.nextAiringEpisode.airingAt * 1000,
        }
      : null,
    recentEpisodeAiredAt: null,
    numberAiredEpisodes: getAiredEpisodes(media),
    numberEpisodes: media.episodes ?? 0,
    endDate: new Date(`${media.endDate.year}-${media.endDate.month}-${media.endDate.day}`),
  };
}

/**
 * Adds when the latest episode aired to anime that may have a new one: only anime being watched,
 * not rewatched, with an aired episode the user hasn't watched, and only airings recent enough to
 * count as new. It only decides the "New" badge, so the list still shows without it when AniList
 * fails to answer
 */
export async function withRecentAirings(animeList: Anime[]): Promise<Anime[]> {
  const mediaIds = animeList
    .filter((anime) => !anime.rewatching && (anime.numberAiredEpisodes ?? 0) > anime.currentEpisode)
    .map((anime) => anime.id);
  if (mediaIds.length === 0) return animeList;
  let recentAirings: Map<number, number>;
  try {
    recentAirings = await getLatestAirings(
      mediaIds,
      Math.floor((Date.now() - NEW_EPISODE_MS) / 1000)
    );
  } catch (error) {
    console.error('Could not get recent airings from AniList', error);
    return animeList;
  }
  return animeList.map((anime) => ({
    ...anime,
    recentEpisodeAiredAt: (recentAirings.get(anime.id) ?? 0) * 1000 || null,
  }));
}
