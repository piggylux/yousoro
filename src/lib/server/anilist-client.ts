import type { NyaaSeries } from '#lib/nyaa.js';
import { retryAfterSeconds } from '#lib/read-retry.js';
import { DEFAULT_SCORE_FORMAT, isScoreFormat, type ScoreFormat } from '#lib/score.js';
import { fingerprint, pauseAniList, takeAniListRequest } from '#lib/server/rate-limit.js';
import type { AiringStatus } from '#lib/types/anime.js';
import type { FriendWatchingResult, SharedAnime } from '#lib/types/friend-watching.js';
import type { ScheduleResult, ScheduledEpisode } from '#lib/types/schedule.js';

const ANILIST_URL = 'https://graphql.anilist.co';
const publicCache = new Map<string, { data: unknown; expiresAt: number }>();
const pendingReads = new Map<string, Promise<unknown>>();
const airingCache = new Map<
  number,
  { since: number; airingAt: number | null; expiresAt: number }
>();
const MAX_CACHE_ENTRIES = 100;

const MEDIA_FIELDS = `
  id
  title { romaji english }
  synonyms
  status
  episodes
  coverImage { extraLarge }
  endDate { year month day }
  nextAiringEpisode { episode airingAt }
  isAdult
  meanScore
`;

export type AniListMedia = {
  id: number;
  title: { romaji: string; english: string | null };
  /** Other names the anime goes by, in any language; AniList may send null instead of a list */
  synonyms: string[] | null;
  status: AiringStatus;
  episodes: number | null;
  coverImage: { extraLarge: string };
  endDate: { year: number | null; month: number | null; day: number | null };
  /** `airingAt` is Unix time in seconds */
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  /** AniList's flag for adult (18+) titles */
  isAdult: boolean;
  /** The average of all AniList users' scores, out of 100; null until enough have scored it */
  meanScore: number | null;
};

export type AniListEntry = {
  /** CURRENT is "Watching"; REPEATING is "Rewatching" */
  status: 'CURRENT' | 'REPEATING';
  progress: number;
  /** The user's score, in their own score format; 0 when they haven't scored it */
  score: number;
  /** Unix time in seconds of the last change to the entry, or 0 when AniList doesn't know */
  updatedAt: number;
  media: AniListMedia;
};

type GraphQLResponse<T> = {
  data: T | null;
  errors?: { message: string; status?: number }[];
};

/** Thrown when AniList rejects the access token, e.g. once a user's token has expired. */
export class AniListTokenError extends Error {}

/** Thrown when AniList has no user by the requested name. */
export class AniListNotFoundError extends Error {}

export class AniListRateLimitError extends Error {
  constructor(public retryAfter: number) {
    super('AniList request limit reached, please try again shortly');
  }
}

/**
 * Sends a query as the given user, or anonymously when there is no token. Public data needs no
 * token, so the app never holds credentials of its own.
 */
async function query<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
  options: { cacheTtlMs?: number; optional?: boolean } = {}
): Promise<T> {
  const readKey = query.trimStart().startsWith('query')
    ? fingerprint(JSON.stringify([query, variables, token || null]))
    : null;
  // Authenticated reads are only coalesced while pending, never stored in the public cache.
  const cacheKey = !token && readKey ? `yousoro:public:${readKey}` : null;
  if (cacheKey) {
    const cached = publicCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;
    publicCache.delete(cacheKey);
  }
  if (readKey && pendingReads.has(readKey)) return pendingReads.get(readKey) as Promise<T>;
  // A post-save reload must never join a read that started before the write.
  if (!readKey) pendingReads.clear();
  const pending = sendQuery<T>(query, variables, token, options.optional)
    .then((data) => {
      if (cacheKey) {
        if (publicCache.size >= MAX_CACHE_ENTRIES)
          publicCache.delete(publicCache.keys().next().value!);
        publicCache.set(cacheKey, { data, expiresAt: Date.now() + (options.cacheTtlMs ?? 30_000) });
      }
      return data;
    })
    .finally(() => {
      if (!readKey) pendingReads.clear();
      else if (pendingReads.get(readKey) === pending) pendingReads.delete(readKey);
    });
  if (readKey && pendingReads.size < MAX_CACHE_ENTRIES) pendingReads.set(readKey, pending);
  return pending;
}

async function sendQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
  optional = false
): Promise<T> {
  const budget = await takeAniListRequest(optional);
  if (!budget.allowed) throw new AniListRateLimitError(budget.retryAfter);
  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (response.status === 429) {
    const retryAfter = retryAfterSeconds(response.headers.get('Retry-After'));
    await pauseAniList(retryAfter);
    throw new AniListRateLimitError(retryAfter);
  }
  const body: GraphQLResponse<T> = await response.json();

  if (!response.ok || body.errors || !body.data) {
    const messages = body.errors?.map((error) => error.message).join(', ') ?? response.statusText;
    if (body.errors?.some((error) => error.message === 'Invalid token')) {
      throw new AniListTokenError(messages);
    }
    if (body.errors?.some((error) => error.status === 404)) {
      throw new AniListNotFoundError(messages);
    }
    throw new Error(`AniList API returned ${response.status}: ${messages}`);
  }

  return body.data;
}

/** Fetches a user's "Watching" and "Rewatching" lists, media details included, in one request. */
export async function getWatchingEntries(
  userName: string,
  token?: string
): Promise<{
  userId: number;
  userName: string;
  avatarUrl: string | null;
  /** How the user scores anime, which their entries' scores are in */
  scoreFormat: ScoreFormat;
  entries: AniListEntry[];
}> {
  const data = await query<{
    MediaListCollection: {
      user: {
        id: number;
        name: string;
        avatar: { large: string | null } | null;
        mediaListOptions: { scoreFormat: string | null } | null;
      };
      lists: { isCustomList: boolean; entries: AniListEntry[] }[];
    };
  }>(
    `query ($userName: String) {
      MediaListCollection(userName: $userName, type: ANIME, status_in: [CURRENT, REPEATING]) {
        user { id name avatar { large } mediaListOptions { scoreFormat } }
        lists {
          isCustomList
          entries {
            status
            progress
            score
            updatedAt
            media { ${MEDIA_FIELDS} }
          }
        }
      }
    }`,
    { userName },
    token
  );

  return {
    userId: data.MediaListCollection.user.id,
    userName: data.MediaListCollection.user.name,
    avatarUrl: data.MediaListCollection.user.avatar?.large ?? null,
    scoreFormat: isScoreFormat(data.MediaListCollection.user.mediaListOptions?.scoreFormat)
      ? data.MediaListCollection.user.mediaListOptions.scoreFormat
      : DEFAULT_SCORE_FORMAT,
    // Custom lists repeat entries that already appear in the status list
    entries: data.MediaListCollection.lists
      .filter((list) => !list.isCustomList)
      .flatMap((list) => list.entries),
  };
}

/**
 * When each of the given anime last aired an episode, as Unix time in seconds, for those that aired
 * one after `since` (Unix time in seconds); the others are left out. One page of 50 airings, newest
 * first, is plenty for the day or two `since` covers
 */
export async function getLatestAirings(
  mediaIds: number[],
  since: number
): Promise<Map<number, number>> {
  const latest = new Map<number, number>();
  const missing = [...new Set(mediaIds)]
    .sort((a, b) => a - b)
    .filter((id) => {
      const cached = airingCache.get(id);
      if (!cached || cached.expiresAt <= Date.now() || cached.since > since) return true;
      if (cached.airingAt !== null && cached.airingAt > since) latest.set(id, cached.airingAt);
      return false;
    });
  if (!missing.length) return latest;
  // Stable timestamps let simultaneous refreshes reuse the same public request too.
  const querySince = Math.floor(since / 30) * 30;
  const data = await query<{
    Page: { airingSchedules: { mediaId: number; airingAt: number }[] };
  }>(
    `query ($ids: [Int], $since: Int) {
      Page(perPage: 50) {
        airingSchedules(
          mediaId_in: $ids
          airingAt_greater: $since
          notYetAired: false
          sort: TIME_DESC
        ) {
          mediaId
          airingAt
        }
      }
    }`,
    { ids: missing, since: querySince },
    undefined,
    { optional: true }
  );
  const fetched = new Map<number, number>();
  // Newest first, so each anime's first airing is its latest
  for (const { mediaId, airingAt } of data.Page.airingSchedules) {
    if (!fetched.has(mediaId)) fetched.set(mediaId, airingAt);
  }
  for (const id of missing) {
    if (airingCache.size >= 1000) airingCache.delete(airingCache.keys().next().value!);
    const airingAt = fetched.get(id) ?? null;
    airingCache.set(id, { since: querySince, airingAt, expiresAt: Date.now() + 30_000 });
    if (airingAt !== null && airingAt > since) latest.set(id, airingAt);
  }
  return latest;
}

// Earlier parts are finished, so a series' count changes only when AniList's data does
const seriesCache = new Map<number, { series: NyaaSeries; expiresAt: number }>();
const ARC_TTL_MS = 24 * 60 * 60 * 1000;
// Until AniList knows how long an earlier part is, which can be soon after it ends
const UNKNOWN_LENGTH_TTL_MS = 60 * 60 * 1000;
// Bleach: Thousand-Year Blood War has four parts; a longer chain is more likely a wrong count
const MAX_EARLIER_PARTS = 8;
const SERIES_FORMATS = ['TV', 'TV_SHORT', 'ONA'];

// A title's words, without the punctuation ending them: "Kokurasetai:" and "Kokurasetai?" match
const titleWords = (title: string) =>
  title
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]+$/u, ''))
    .filter(Boolean);

/**
 * The first part's title, up to the words the parts share, as release names number the series
 * under it: "JoJo no Kimyou na Bouken: Steel Ball Run" for its "- 1st STAGE"
 */
function seriesTitle(title: string, length: number) {
  const words: string[] = [];
  let count = 0;
  for (const word of title.split(/\s+/)) {
    if (count === length) break;
    words.push(word);
    if (word.replace(/[^\p{L}\p{N}]+$/u, '')) count++;
  }
  return words.join(' ').replace(/[\s:\-–—]+$/, '');
}

/**
 * What an anime's search needs from the other entries of its series. `arc` is the first part of
 * the series it continues, when AniList splits it in several entries, and how many episodes come
 * before it. Earlier TV parts count while their titles start with the words the anime's title
 * shares with the part right before it, less any season words, so the 366 episodes of Bleach
 * don't count for Bleach: Thousand-Year Blood War. Null when there's no earlier part or the count
 * is uncertain, as a wrong count would find another episode. `related` are the titles of the
 * series' other TV entries, as "Yu☆Gi☆Oh! Duel Monsters GX" for Yu☆Gi☆Oh! Duel Monsters, and
 * `native` the anime's own title in its language, which many sukebei.nyaa.si releases use
 */
export async function getSeries(mediaId: number): Promise<NyaaSeries> {
  const cached = seriesCache.get(mediaId);
  if (cached && cached.expiresAt > Date.now()) return cached.series;
  const part = async (id: number) => {
    const data = await query<{
      Media: {
        title: { romaji: string; native: string | null };
        relations: {
          edges: {
            relationType: string;
            node: {
              id: number;
              type: string;
              format: string | null;
              episodes: number | null;
              title: { romaji: string; english: string | null };
            };
          }[];
        };
      };
    }>(
      `query ($id: Int) {
        Media(id: $id) {
          title { romaji native }
          relations {
            edges { relationType node { id type format episodes title { romaji english } } }
          }
        }
      }`,
      { id },
      undefined,
      { optional: true }
    );
    const entries = data.Media.relations.edges.filter(
      ({ node }) => node.type === 'ANIME' && SERIES_FORMATS.includes(node.format ?? '')
    );
    return {
      title: data.Media.title.romaji,
      native: data.Media.title.native,
      earlier: entries
        .filter(({ relationType }) => relationType === 'PREQUEL')
        .map(({ node }) => node),
      related: entries.flatMap(({ node }) => [node.title.romaji, node.title.english ?? []].flat()),
    };
  };

  const first = await part(mediaId);
  let unknownLength = false;
  const arc = await (async () => {
    let current = first;
    if (current.earlier.length !== 1) return null;
    const words = titleWords(current.title);
    const before = titleWords(current.earlier[0].title.romaji);
    const series: string[] = [];
    while (series.length < words.length && words[series.length] === before[series.length])
      series.push(words[series.length]);
    // "SPY×FAMILY Season 3" and "SPY×FAMILY Season 2" are both "SPY×FAMILY"
    while (series.length && /^(season|part|cour|\d+(st|nd|rd|th)?)$/.test(series.at(-1)!))
      series.pop();
    if (!series.length) return null;

    let offset = 0;
    for (let count = 0; count < MAX_EARLIER_PARTS; count++) {
      const earlier = current.earlier.filter(({ title }) =>
        series.every((word, index) => titleWords(title.romaji)[index] === word)
      );
      if (!earlier.length)
        return offset
          ? { offset, title: seriesTitle(current.title, series.length), season: count + 1 }
          : null;
      if (earlier.length > 1) return null;
      if (!earlier[0].episodes) {
        unknownLength = true;
        return null;
      }
      offset += earlier[0].episodes;
      current = await part(earlier[0].id);
    }
    return null;
  })();
  const series = { arc, related: first.related, native: first.native };
  if (seriesCache.size >= 1000) seriesCache.delete(seriesCache.keys().next().value!);
  seriesCache.set(mediaId, {
    series,
    expiresAt: Date.now() + (unknownLength ? UNKNOWN_LENGTH_TTL_MS : ARC_TTL_MS),
  });
  return series;
}

export type AniListUser = { id: number; name: string; avatarUrl: string | null };

// Airings are public metadata. Neither credentials nor a user's list are cached here.
const scheduleCache = new Map<
  string,
  { episodes: ScheduledEpisode[]; freshUntil: number; expiresAt: number; fetchedAt: number }
>();
export async function getUpcomingAirings(
  mediaIds: number[],
  from: number,
  until: number
): Promise<ScheduleResult> {
  const ids = [...new Set(mediaIds)].sort((a, b) => a - b);
  const episodes = new Map<string, ScheduledEpisode>();
  const fallback = new Map<number, { episodes: ScheduledEpisode[]; fetchedAt: number }>();
  const timestamps: number[] = [];
  const add = (episode: ScheduledEpisode) =>
    episodes.set(`${episode.mediaId}:${episode.episode}`, episode);
  const missing = ids.filter((id) => {
    const key = `${from}:${until}:${id}`;
    const cached = scheduleCache.get(key);
    if (cached && cached.freshUntil > Date.now()) {
      cached.episodes.forEach(add);
      timestamps.push(cached.fetchedAt);
      return false;
    }
    if (cached && cached.expiresAt > Date.now()) fallback.set(id, cached);
    else scheduleCache.delete(key);
    return true;
  });
  const requested = new Set(missing);
  let partial = false;
  let retryAfter: number | undefined;
  let partialReason: ScheduleResult['partialReason'];
  for (let page = 1; missing.length && page <= 4; page++) {
    try {
      const data = await query<{
        Page: {
          pageInfo: { hasNextPage: boolean };
          airingSchedules: { mediaId: number; episode: number; airingAt: number }[];
        };
      }>(
        `query ($ids: [Int], $from: Int, $until: Int, $page: Int) {
          Page(page: $page, perPage: 50) {
            pageInfo { hasNextPage }
            airingSchedules(mediaId_in: $ids, airingAt_greater: $from, airingAt_lesser: $until, sort: TIME) {
              mediaId episode airingAt
            }
          }
        }`,
        { ids: missing, from: from - 1, until, page },
        undefined,
        { optional: true, cacheTtlMs: 60 * 60 * 1000 }
      );
      for (const airing of data.Page.airingSchedules) {
        if (requested.has(airing.mediaId) && airing.airingAt >= from && airing.airingAt < until)
          add({ mediaId: airing.mediaId, episode: airing.episode, airsAt: airing.airingAt * 1000 });
      }
      partial = data.Page.pageInfo.hasNextPage;
      if (!partial) break;
    } catch (err) {
      if (page === 1 && episodes.size === 0 && fallback.size === 0) throw err;
      partial = true;
      partialReason = 'unavailable';
      if (err instanceof AniListRateLimitError) retryAfter = err.retryAfter;
      break;
    }
  }
  if (!partial) {
    const fetchedAt = Date.now();
    const freshUntil = fetchedAt + 60 * 60 * 1000;
    const expiresAt = fetchedAt + 24 * 60 * 60 * 1000;
    for (const id of missing) {
      if (scheduleCache.size >= 2000) scheduleCache.delete(scheduleCache.keys().next().value!);
      scheduleCache.set(`${from}:${until}:${id}`, {
        episodes: [...episodes.values()].filter((episode) => episode.mediaId === id),
        expiresAt,
        freshUntil,
        fetchedAt,
      });
    }
    timestamps.push(fetchedAt);
  } else {
    for (const saved of fallback.values()) {
      timestamps.push(saved.fetchedAt);
      for (const episode of saved.episodes) {
        if (!episodes.has(`${episode.mediaId}:${episode.episode}`)) add(episode);
      }
    }
  }
  return {
    episodes: [...episodes.values()].sort(
      (a, b) => a.airsAt - b.airsAt || a.mediaId - b.mediaId || a.episode - b.episode
    ),
    partial,
    fetchedAt: timestamps.length ? Math.min(...timestamps) : Date.now(),
    ...(partial && fallback.size ? { stale: true } : {}),
    ...(partial ? { partialReason: partialReason ?? 'limit' } : {}),
    ...(retryAfter ? { retryAfter } : {}),
  };
}

/** One lookup for all cards, without downloading each friend's list. */
export async function getFriendsWatching(
  token: string,
  viewerId: number,
  mediaIds: number[]
): Promise<FriendWatchingResult> {
  const result: FriendWatchingResult = { matches: {}, partial: false };
  if (!mediaIds.length) return result;
  const wanted = new Set(mediaIds);
  for (let page = 1; page <= 4; page++) {
    const data = await query<{
      Viewer?: AniListUserFields | null;
      self?: {
        lists: {
          isCustomList: boolean;
          entries: {
            mediaId: number;
            progress: number;
            status: string;
          }[];
        }[];
      } | null;
      Page: {
        pageInfo: { hasNextPage: boolean };
        mediaList: {
          mediaId: number;
          progress: number;
          status: string;
          user: AniListUserFields;
        }[];
      };
    }>(
      `query ($ids: [Int], $page: Int, $viewerId: Int!, $includeViewer: Boolean!) {
        Viewer @include(if: $includeViewer) { id name avatar { large } }
        self: MediaListCollection(userId: $viewerId, type: ANIME, status_in: [CURRENT, REPEATING])
          @include(if: $includeViewer) {
          lists { isCustomList entries { mediaId progress status } }
        }
        Page(page: $page, perPage: 50) {
          pageInfo { hasNextPage }
          mediaList(type: ANIME, isFollowing: true, mediaId_in: $ids,
            status_in: [CURRENT, REPEATING], sort: MEDIA_ID) {
            mediaId progress status user { id name avatar { large } }
          }
        }
      }`,
      { ids: mediaIds, page, viewerId, includeViewer: page === 1 },
      token,
      { optional: true }
    ).catch((error) => {
      // Keep already-loaded matches if the optional budget runs out mid-pagination.
      if (page > 1 && error instanceof AniListRateLimitError) {
        result.retryAfter = error.retryAfter;
        return null;
      }
      throw error;
    });
    if (!data) {
      result.partial = true;
      break;
    }
    if (page === 1 && data.Viewer && data.self) {
      if (data.Viewer.id !== viewerId)
        throw new AniListTokenError('Your AniList account changed, please sign in again');
      for (const list of data.self.lists) {
        if (list.isCustomList) continue;
        for (const entry of list.entries) {
          if (!wanted.has(entry.mediaId) || !['CURRENT', 'REPEATING'].includes(entry.status))
            continue;
          const people = (result.matches[entry.mediaId] ??= []);
          if (!people.some((person) => person.id === viewerId))
            people.push({
              ...toUser(data.Viewer),
              progress: entry.progress,
              rewatching: entry.status === 'REPEATING',
              isViewer: true,
            });
        }
      }
    }
    const { Page } = data;
    for (const entry of Page.mediaList) {
      if (
        !wanted.has(entry.mediaId) ||
        entry.user.id === viewerId ||
        !['CURRENT', 'REPEATING'].includes(entry.status)
      )
        continue;
      const friends = (result.matches[entry.mediaId] ??= []);
      if (!friends.some((friend) => friend.id === entry.user.id)) {
        friends.push({
          ...toUser(entry.user),
          progress: entry.progress,
          rewatching: entry.status === 'REPEATING',
        });
      }
    }
    result.partial = Page.pageInfo.hasNextPage;
    if (!result.partial) break;
  }
  for (const friends of Object.values(result.matches)) {
    friends.sort(
      (a, b) => Number(!!b.isViewer) - Number(!!a.isViewer) || a.name.localeCompare(b.name)
    );
  }
  return result;
}

/** Only the fields needed to compare the viewer with friends; no airing enrichment. */
export async function getSharedAnime(token: string, userId: number): Promise<SharedAnime[]> {
  const { MediaListCollection } = await query<{
    MediaListCollection: {
      lists: {
        isCustomList: boolean;
        entries: {
          media: {
            id: number;
            isAdult: boolean;
            title: { romaji: string };
            coverImage?: { large: string | null };
          };
        }[];
      }[];
    };
  }>(
    `query ($userId: Int) {
      MediaListCollection(userId: $userId, type: ANIME, status_in: [CURRENT, REPEATING]) {
        lists { isCustomList entries { media { id title { romaji } isAdult coverImage { large } } } }
      }
    }`,
    { userId },
    token,
    { optional: true }
  );
  return MediaListCollection.lists
    .filter((list) => !list.isCustomList)
    .flatMap((list) =>
      list.entries.map(({ media }) => ({
        id: media.id,
        title: media.title.romaji,
        isAdult: media.isAdult,
        coverUrl: media.coverImage?.large,
      }))
    );
}

type AniListUserFields = { id: number; name: string; avatar: { large: string | null } | null };

function toUser(user: AniListUserFields): AniListUser {
  return { id: user.id, name: user.name, avatarUrl: user.avatar?.large ?? null };
}

// AniList returns at most 50 per page; 4 pages keeps a big following list to 5 requests in all
const FOLLOWING_PAGE_SIZE = 50;
const FOLLOWING_MAX_PAGES = 4;

/**
 * The users someone follows on AniList, by name. AniList has no separate friends feature, so
 * these are their friends. `total` can be larger than the list when it stops at the page limit.
 */
export async function getFollowing(
  userName: string,
  token?: string,
  knownUser?: AniListUser
): Promise<{ user: AniListUser; following: AniListUser[]; total: number }> {
  const user =
    knownUser && knownUser.name.toLowerCase() === userName.toLowerCase()
      ? knownUser
      : toUser(
          (
            await query<{ User: AniListUserFields }>(
              'query ($name: String) { User(name: $name) { id name avatar { large } } }',
              { name: userName },
              token,
              { cacheTtlMs: 5 * 60 * 1000 }
            )
          ).User
        );

  const following: AniListUser[] = [];
  let total = 0;
  for (let page = 1; page <= FOLLOWING_MAX_PAGES; page++) {
    const { Page } = await query<{
      Page: {
        pageInfo: { total: number; hasNextPage: boolean };
        following: AniListUserFields[];
      };
    }>(
      `query ($id: Int!, $page: Int) {
        Page(page: $page, perPage: ${FOLLOWING_PAGE_SIZE}) {
          pageInfo { total hasNextPage }
          following(userId: $id, sort: USERNAME) { id name avatar { large } }
        }
      }`,
      { id: user.id, page },
      token,
      { cacheTtlMs: 5 * 60 * 1000 }
    );
    following.push(...Page.following.map(toUser));
    total = Page.pageInfo.total;
    if (!Page.pageInfo.hasNextPage) break;
  }

  return { user, following, total };
}

/** The user the token belongs to. */
export async function getViewer(token: string): Promise<AniListUser> {
  if (!token) throw new AniListTokenError('An access token is required to identify the user');

  const data = await query<{ Viewer: AniListUserFields }>(
    'query { Viewer { id name avatar { large } } }',
    {},
    token
  );

  return toUser(data.Viewer);
}

/**
 * Updates the token owner's own list entry: the watched episode count, the score (in their own
 * score format, 0 clearing it), or both. What isn't given is left as it is.
 */
export async function saveEntry(
  token: string,
  mediaId: number,
  changes: { progress?: number; score?: number }
): Promise<{ progress: number; score: number; status: string }> {
  if (!token) throw new AniListTokenError('An access token is required to update a list');

  const data = await query<{
    SaveMediaListEntry: { progress: number; score: number; status: string };
  }>(
    `mutation ($mediaId: Int, $progress: Int, $score: Float) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress, score: $score) { progress score status }
    }`,
    // Left out of the JSON when undefined, so AniList keeps the current value
    { mediaId, progress: changes.progress, score: changes.score },
    token
  );

  return data.SaveMediaListEntry;
}

export function getAiredEpisodes(media: AniListMedia): number | null {
  if (media.status === 'FINISHED') {
    return media.episodes;
  }

  if (media.status === 'NOT_YET_RELEASED') {
    return null;
  }

  // Airing shows may have no next episode scheduled yet
  return media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : null;
}
