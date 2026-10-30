import { getMediaByMalIds } from '#lib/server/anilist-client.js';
import { toAnime, withRecentAirings } from '#lib/server/anilist.js';
import { getWatchingEntries } from '#lib/server/myanimelist-client.js';
import type { AniListPriority } from '#lib/server/rate-limit.js';
import type { Anime } from '#lib/types/anime.js';
import type { Api, UnmatchedAnime, UserAnimeList } from '#lib/types/api.js';
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
    priority?: AniListPriority
  ): Promise<UserAnimeList> {
    const entries = await getWatchingEntries(username, this.signedIn?.token);
    const media = await getMediaByMalIds(
      entries.map((entry) => entry.node.id),
      priority
    );

    const animeList: Anime[] = [];
    const unmatched: UnmatchedAnime[] = [];
    const seen = new Set<number>();
    for (const { node, list_status } of entries) {
      const details = media.get(node.id);
      if (!details) {
        unmatched.push({ malId: node.id, title: node.title, isAdult: node.nsfw === 'black' });
        continue;
      }
      // Two MyAnimeList entries rarely lead to one AniList anime, which may only be shown once
      if (seen.has(details.id)) continue;
      seen.add(details.id);
      animeList.push(
        toAnime(details, {
          progress: list_status.num_episodes_watched,
          score: list_status.score,
          rewatching: list_status.is_rewatching,
          updatedAt: Date.parse(list_status.updated_at) || null,
        })
      );
    }

    const owner = this.signedIn?.owner;
    return {
      userId: owner?.id ?? null,
      username: owner?.name ?? username,
      avatarUrl: owner?.avatarUrl ?? null,
      // MyAnimeList scores are whole numbers out of 10
      scoreFormat: 'POINT_10',
      animeList: enrichAirings ? await withRecentAirings(animeList) : animeList,
      unmatched,
    };
  }
}
