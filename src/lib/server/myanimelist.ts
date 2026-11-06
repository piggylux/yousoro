import { getMediaByMalIds, type AniListMedia } from '#lib/server/anilist-client.js';
import { toAnime, withRecentAirings } from '#lib/server/anilist.js';
import {
  getPlanToWatchEntries,
  getWatchingEntries,
  type MalAiringStatus,
  type MalEntry,
} from '#lib/server/myanimelist-client.js';
import type { RequestPriority } from '#lib/server/rate-limit.js';
import type { AiringStatus, Anime } from '#lib/types/anime.js';
import type { Api, PlannedList, UnmatchedAnime, UserAnimeList } from '#lib/types/api.js';
import type { SessionUser } from '#lib/types/session-user.js';

/**
 * MyAnimeList lists. Progress and scores come from MyAnimeList; everything about the anime itself,
 * aired episodes and the next airing included, comes from AniList, found by MyAnimeList id
 */
export class MyAnimeListApi implements Api {
  /**
   * With the signed-in user's token, reads their own list, private or not; MyAnimeList only says
   * who a list belongs to then, so `owner` is who signed in
   */
  constructor(private signedIn?: { token: string; owner: SessionUser }) {}

  async getUserAnimeList(
    username: string,
    enrichAirings = true,
    priority?: RequestPriority
  ): Promise<UserAnimeList> {
    const list = await this.buildList(username, await this.getWatchingEntries(username), {
      priority,
    });
    return enrichAirings ? { ...list, animeList: await withRecentAirings(list.animeList) } : list;
  }

  /** Someone's Watching and Rewatching entries, as MyAnimeList has them, for `buildList` */
  getWatchingEntries(username: string): Promise<MalEntry[]> {
    return getWatchingEntries(username, this.signedIn?.token);
  }

  /**
   * The list from its MyAnimeList entries, with AniList's details of each anime. `known` anime,
   * by MyAnimeList id, are taken as they are rather than asked about again, as when the owner's
   * AniList list has them already; AniList is asked about the rest, 50 at a time
   */
  async buildList(
    username: string,
    entries: MalEntry[],
    { known, priority }: { known?: Map<number, Anime>; priority?: RequestPriority } = {}
  ): Promise<UserAnimeList> {
    const unknown = entries.map((entry) => entry.node.id).filter((id) => !known?.has(id));
    const media = unknown.length
      ? await getMediaByMalIds(unknown, priority)
      : new Map<number, AniListMedia>();

    const animeList: Anime[] = [];
    const unmatched: UnmatchedAnime[] = [];
    const seen = new Set<number>();
    for (const { node, list_status } of entries) {
      const entry = {
        progress: list_status.num_episodes_watched,
        score: list_status.score,
        rewatching: list_status.is_rewatching,
        updatedAt: Date.parse(list_status.updated_at) || null,
      };
      const knownAnime = known?.get(node.id);
      const details = knownAnime ? null : media.get(node.id);
      if (!knownAnime && !details) {
        unmatched.push({ malId: node.id, title: node.title, isAdult: node.nsfw === 'black' });
        continue;
      }
      const anime = knownAnime ? withEntry(knownAnime, entry) : toAnime(details!, entry);
      // Two MyAnimeList entries rarely lead to one AniList anime, which may only be shown once
      if (seen.has(anime.id)) continue;
      seen.add(anime.id);
      animeList.push(anime);
    }

    const owner = this.signedIn?.owner;
    return {
      userId: owner?.id ?? null,
      username: owner?.name ?? username,
      avatarUrl: owner?.avatarUrl ?? null,
      // MyAnimeList scores are whole numbers out of 10
      scoreFormat: 'POINT_10',
      animeList,
      unmatched,
    };
  }

  /**
   * Unlike watching lists, plan-to-watch lists are shown as MyAnimeList has them, without asking
   * AniList about each anime: they're often hundreds long, and AniList answers for 50 at a time
   */
  async getPlannedAnime(username: string): Promise<PlannedList> {
    const entries = await getPlanToWatchEntries(username, this.signedIn?.token);
    const owner = this.signedIn?.owner;
    return {
      userId: owner?.id ?? null,
      username: owner?.name ?? username,
      planned: entries.map(toPlannedAnime),
    };
  }
}

/** An anime already read from AniList, with this list's entry for it rather than another list's */
function withEntry(
  anime: Anime,
  entry: { progress: number; score: number; rewatching: boolean; updatedAt: number | null }
): Anime {
  return {
    ...anime,
    userScore: entry.score || null,
    currentEpisode: entry.progress,
    rewatching: entry.rewatching,
    lastUpdatedAt: entry.updatedAt,
    recentEpisodeAiredAt: null,
  };
}

const AIRING_STATUSES: Record<MalAiringStatus, AiringStatus> = {
  finished_airing: 'FINISHED',
  currently_airing: 'RELEASING',
  not_yet_aired: 'NOT_YET_RELEASED',
};

function toPlannedAnime({ node, list_status }: MalEntry): PlannedList['planned'][number] {
  return {
    id: null,
    malId: node.id,
    title: node.title,
    englishTitle: node.alternative_titles?.en || null,
    coverUrl: node.main_picture?.medium ?? null,
    isAdult: node.nsfw === 'black',
    // An anime MyAnimeList doesn't give a status for has most likely aired already
    status: (node.status && AIRING_STATUSES[node.status]) ?? 'FINISHED',
    episodes: node.num_episodes || null,
    // Out of 10 with two decimals on MyAnimeList, out of 100 like AniList's here
    meanScore: node.mean ? Math.round(node.mean * 10) : null,
    year: node.start_season?.year ?? null,
    genres: node.genres?.map(({ name }) => name) ?? [],
    addedAt: Date.parse(list_status.updated_at) || null,
    // Without AniList ids there is nothing to match prequels or sequels on
    startedOn: null,
    prequelIds: [],
    allSequels: [],
  };
}
