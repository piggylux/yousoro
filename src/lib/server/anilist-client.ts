import { DEFAULT_SCORE_FORMAT, isScoreFormat, type ScoreFormat } from '#lib/score.js';
import { fingerprint, pauseAniList, takeAniListRequest } from '#lib/server/rate-limit.js';
import type { AiringStatus } from '#lib/types/anime.js';

const ANILIST_URL = 'https://graphql.anilist.co';
const publicCache = new Map<string, { data: unknown; expiresAt: number }>();
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
  token?: string
): Promise<T> {
  // Only anonymous reads are shared. Authenticated/private results never enter this cache.
  const cacheKey =
    !token && query.trimStart().startsWith('query')
      ? `yousoro:public:${fingerprint(JSON.stringify([query, variables]))}`
      : null;
  if (cacheKey) {
    const cached = publicCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;
    publicCache.delete(cacheKey);
  }
  const budget = await takeAniListRequest();
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
    const retry = response.headers.get('Retry-After');
    const seconds =
      retry && /^\d+$/.test(retry)
        ? Number(retry)
        : retry
          ? (Date.parse(retry) - Date.now()) / 1000
          : 60;
    const retryAfter = Number.isFinite(seconds)
      ? Math.max(1, Math.min(300, Math.ceil(seconds)))
      : 60;
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

  if (cacheKey) {
    if (publicCache.size >= MAX_CACHE_ENTRIES) {
      publicCache.delete(publicCache.keys().next().value!);
    }
    publicCache.set(cacheKey, { data: body.data, expiresAt: Date.now() + 30_000 });
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
    { ids: mediaIds, since }
  );
  const latest = new Map<number, number>();
  // Newest first, so each anime's first airing is its latest
  for (const { mediaId, airingAt } of data.Page.airingSchedules) {
    if (!latest.has(mediaId)) latest.set(mediaId, airingAt);
  }
  return latest;
}

export type AniListUser = { id: number; name: string; avatarUrl: string | null };

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
  token?: string
): Promise<{ user: AniListUser; following: AniListUser[]; total: number }> {
  const { User } = await query<{ User: AniListUserFields }>(
    'query ($name: String) { User(name: $name) { id name avatar { large } } }',
    { name: userName },
    token
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
      { id: User.id, page },
      token
    );
    following.push(...Page.following.map(toUser));
    total = Page.pageInfo.total;
    if (!Page.pageInfo.hasNextPage) break;
  }

  return { user: toUser(User), following, total };
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
