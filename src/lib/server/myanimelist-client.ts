import { MAL_CLIENT_ID } from '$app/env/private';

import { retryAfterSeconds } from '#lib/read-retry.js';
import { pauseMal, takeMalRequest } from '#lib/server/rate-limit.js';
import type { SessionUser } from '#lib/types/session-user.js';

const API_URL = 'https://api.myanimelist.net/v2';

/** A list status, as MyAnimeList names it */
export type MalListStatus = 'watching' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_watch';

export type MalListStatusData = {
  status: MalListStatus;
  /** From 1 to 10; 0 when the user hasn't scored it */
  score: number;
  num_episodes_watched: number;
  is_rewatching: boolean;
  /** When the user last changed the entry, in ISO 8601 */
  updated_at: string;
  num_times_rewatched?: number;
};

export type MalEntry = {
  /** `nsfw` is "white", "gray", or "black" for adult anime */
  node: { id: number; title: string; nsfw?: string };
  list_status: MalListStatusData;
};

type MalPage = { data: MalEntry[]; paging?: { next?: string } };

/** Thrown when MyAnimeList rejects a user's access token, e.g. once it has expired */
export class MalTokenError extends Error {}

/** Thrown when MyAnimeList has no user, or no anime, by the requested name or id */
export class MalNotFoundError extends Error {}

/** Thrown when MyAnimeList won't share something, as when its owner made their list private */
export class MalForbiddenError extends Error {}

export class MalRateLimitError extends Error {
  constructor(public retryAfter: number) {
    super('MyAnimeList request limit reached, please try again shortly');
  }
}

/**
 * Calls the API as the given user, or with the app's client ID for public data. Only the API's own
 * URLs are requested, so a `paging.next` link from an answer can't lead elsewhere
 */
async function request<T>(
  url: string,
  { token, method = 'GET', body }: { token?: string; method?: string; body?: URLSearchParams } = {}
): Promise<T> {
  if (!url.startsWith(`${API_URL}/`)) throw new Error(`Not a MyAnimeList API URL: ${url}`);
  if (!token && !MAL_CLIENT_ID) throw new Error('MyAnimeList is not configured');
  const budget = await takeMalRequest();
  if (!budget.allowed) throw new MalRateLimitError(budget.retryAfter);

  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : { 'X-MAL-CLIENT-ID': MAL_CLIENT_ID! }),
    },
    body,
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (response.ok) return (await response.json()) as T;

  // Frees the connection now rather than once the unread body is collected
  await response.body?.cancel();
  if (response.status === 429) {
    const retryAfter = retryAfterSeconds(response.headers.get('Retry-After'));
    await pauseMal(retryAfter);
    throw new MalRateLimitError(retryAfter);
  }
  if (response.status === 401 && token) throw new MalTokenError('MyAnimeList rejected the token');
  if (response.status === 404) throw new MalNotFoundError(`MyAnimeList found nothing at ${url}`);
  if (response.status === 403) throw new MalForbiddenError(`MyAnimeList refused ${url}`);
  throw new Error(`MyAnimeList API returned ${response.status} for ${url}`);
}

/** Every page of a list, up to 10 of them: 10,000 entries */
async function readPages(url: string, token?: string): Promise<MalEntry[]> {
  const entries: MalEntry[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < 10; page++) {
    const body: MalPage = await request<MalPage>(next, { token });
    entries.push(...body.data);
    next = body.paging?.next;
  }
  return entries;
}

/**
 * A user's "Watching" anime and the ones they're rewatching: their own with their token, which
 * shows a private list to its owner, or anyone's public list by name
 */
export async function getWatchingEntries(userName: string, token?: string): Promise<MalEntry[]> {
  const path = `${API_URL}/users/${token ? '@me' : encodeURIComponent(userName)}/animelist`;
  const query = 'fields=list_status,nsfw&nsfw=true';
  const [watching, recentlyCompleted] = await Promise.all([
    readPages(`${path}?status=watching&limit=1000&${query}`, token),
    // MyAnimeList keeps a rewatch as a completed entry marked as being rewatched, and doesn't say
    // whether the "watching" filter includes them. A rewatch in progress is among the entries
    // updated last, so the latest completed ones are enough to find it
    request<MalPage>(`${path}?status=completed&sort=list_updated_at&limit=100&${query}`, { token }),
  ]);

  const entries = new Map<number, MalEntry>();
  for (const entry of [...watching, ...recentlyCompleted.data]) {
    if (entry.list_status.status === 'watching' || entry.list_status.is_rewatching) {
      entries.set(entry.node.id, entry);
    }
  }
  return [...entries.values()];
}

/** The token's owner, which also confirms the token works */
export async function getViewer(token: string): Promise<SessionUser> {
  const user = await request<{ id: number; name: string; picture?: string }>(
    `${API_URL}/users/@me`,
    { token }
  );
  return { id: user.id, name: user.name, avatarUrl: user.picture ?? null };
}

const ANILIST_STATUSES: Record<MalListStatus, string> = {
  watching: 'CURRENT',
  completed: 'COMPLETED',
  on_hold: 'PAUSED',
  dropped: 'DROPPED',
  plan_to_watch: 'PLANNING',
};

/** The list status in AniList's terms, which the rest of the app uses */
export function toAniListStatus({
  status,
  is_rewatching,
}: Pick<MalListStatusData, 'status' | 'is_rewatching'>): string {
  return is_rewatching ? 'REPEATING' : (ANILIST_STATUSES[status] ?? 'CURRENT');
}

/**
 * Updates the token owner's own list entry: the watched episode count, the score (from 1 to 10, 0
 * clearing it), or both. What isn't given is left as it is. Unlike AniList, MyAnimeList doesn't
 * finish an anime when its last episode is watched, so this does, as AniList would: a rewatch ends
 * and counts as one more time watched. An anime not yet on the list is added as watching
 */
export async function saveEntry(
  token: string,
  malId: number,
  changes: { progress?: number; score?: number }
): Promise<{ progress: number; score: number; status: string }> {
  const body = new URLSearchParams();
  if (changes.progress !== undefined) {
    // Only a new episode count can finish the anime, so only then are its details needed
    const anime = await request<{
      num_episodes: number;
      my_list_status?: Pick<MalListStatusData, 'is_rewatching' | 'num_times_rewatched'>;
    }>(
      `${API_URL}/anime/${malId}?fields=num_episodes,my_list_status{status,is_rewatching,num_times_rewatched}`,
      { token }
    );
    const current = anime.my_list_status;
    body.set('num_watched_episodes', String(changes.progress));
    if (anime.num_episodes > 0 && changes.progress >= anime.num_episodes) {
      body.set('status', 'completed');
      if (current?.is_rewatching) {
        body.set('is_rewatching', 'false');
        body.set('num_times_rewatched', String((current.num_times_rewatched ?? 0) + 1));
      }
    } else if (!current) {
      body.set('status', 'watching');
    }
  }
  if (changes.score !== undefined) body.set('score', String(changes.score));

  const saved = await request<MalListStatusData>(`${API_URL}/anime/${malId}/my_list_status`, {
    token,
    method: 'PATCH',
    body,
  });
  return {
    progress: saved.num_episodes_watched,
    score: saved.score,
    status: toAniListStatus(saved),
  };
}
