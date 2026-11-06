import { MAL_CLIENT_ID } from '$app/env/private';

import { isUserName } from '#lib/match.js';
import { retryAfterSeconds } from '#lib/read-retry.js';
import { toScore100 } from '#lib/score.js';
import {
  fingerprint,
  pauseMal,
  takeMalRequest,
  type RequestPriority,
} from '#lib/server/rate-limit.js';
import type { TasteProfile } from '#lib/types/match.js';
import type { SessionUser } from '#lib/types/session-user.js';

const API_URL = 'https://api.myanimelist.net/v2';
const publicCache = new Map<string, { data: unknown; expiresAt: number }>();
const pendingReads = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 100;
const PUBLIC_CACHE_MS = 30_000;

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
  /** When the user started and finished it, YYYY-MM-DD or less when partly unknown; left out unset */
  start_date?: string;
  finish_date?: string;
};

/** Whether an anime has aired, as MyAnimeList says it */
export type MalAiringStatus = 'finished_airing' | 'currently_airing' | 'not_yet_aired';

export type MalEntry = {
  /**
   * `nsfw` is "white", "gray", or "black" for adult anime. The fields after it are only there when
   * asked for, as plan-to-watch lists do
   */
  node: {
    id: number;
    title: string;
    nsfw?: string;
    main_picture?: { medium: string; large: string };
    /** 0 while it isn't known */
    num_episodes?: number;
    status?: MalAiringStatus;
    /** The average score, out of 10, when enough people have scored it */
    mean?: number;
    alternative_titles?: { en?: string };
    /** Genres, themes and demographics together, as MyAnimeList sends them */
    genres?: { id: number; name: string }[];
    start_season?: { year: number; season: string };
  };
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

type RequestOptions = {
  token?: string;
  method?: string;
  body?: URLSearchParams;
  priority?: RequestPriority;
  /** `cacheMs: 0` shares a public read while it's under way without keeping its answer here */
  cacheMs?: number;
};

/**
 * Calls the API as the given user, or with the app's client ID for public data. Reads asked for
 * again while one is under way share it, and public ones are kept for 30 seconds, as AniList's are,
 * so a list many people open at once is read once. A user's own reads are never kept, and a write
 * never joins a read that started before it
 */
async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { token, method = 'GET' } = options;
  const readKey = method === 'GET' ? fingerprint(JSON.stringify([url, token ?? null])) : null;
  const cacheKey = readKey && !token && options.cacheMs !== 0 ? readKey : null;
  if (cacheKey) {
    const cached = publicCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;
    publicCache.delete(cacheKey);
  }
  if (readKey && pendingReads.has(readKey)) return pendingReads.get(readKey) as Promise<T>;
  if (!readKey) pendingReads.clear();

  const pending = send<T>(url, options)
    .then((data) => {
      if (cacheKey) {
        if (publicCache.size >= MAX_CACHE_ENTRIES) {
          publicCache.delete(publicCache.keys().next().value!);
        }
        publicCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + (options.cacheMs ?? PUBLIC_CACHE_MS),
        });
      }
      return data;
    })
    .finally(() => {
      if (readKey && pendingReads.get(readKey) === pending) pendingReads.delete(readKey);
    });
  if (readKey && pendingReads.size < MAX_CACHE_ENTRIES) pendingReads.set(readKey, pending);
  return pending;
}

/** Only the API's own URLs are requested, so a `paging.next` link from an answer can't lead elsewhere */
async function send<T>(
  url: string,
  { token, method = 'GET', body, priority }: RequestOptions
): Promise<T> {
  if (!url.startsWith(`${API_URL}/`)) throw new Error(`Not a MyAnimeList API URL: ${url}`);
  if (!token && !MAL_CLIENT_ID) throw new Error('MyAnimeList is not configured');
  const budget = await takeMalRequest(priority);
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
  // MyAnimeList refuses with a 403 when it thinks it's sent too much. With a user's token, which
  // only ever reads or writes their own list, a 403 can't be a private list, so it means slow down
  if (response.status === 429 || (response.status === 403 && token)) {
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
async function readPages(
  url: string,
  token?: string,
  options: Pick<RequestOptions, 'cacheMs' | 'priority'> = {}
): Promise<MalEntry[]> {
  const entries: MalEntry[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < 10; page++) {
    const body: MalPage = await request<MalPage>(next, { token, ...options });
    entries.push(...body.data);
    next = body.paging?.next;
  }
  return entries;
}

/**
 * A user's "Watching" anime and the ones they're rewatching: their own with their token, which
 * shows a private list to its owner, or anyone's public list by name
 */
export async function getWatchingEntries(
  userName: string,
  token?: string,
  priority?: RequestPriority
): Promise<MalEntry[]> {
  const path = `${API_URL}/users/${token ? '@me' : encodeURIComponent(userName)}/animelist`;
  const query = 'fields=list_status,nsfw&nsfw=true';
  const [watching, recentlyCompleted] = await Promise.all([
    readPages(`${path}?status=watching&limit=1000&${query}`, token, { priority }),
    // MyAnimeList keeps a rewatch as a completed entry marked as being rewatched, and doesn't say
    // whether the "watching" filter includes them. A rewatch in progress is among the entries
    // updated last, so the latest completed ones are enough to find it
    request<MalPage>(`${path}?status=completed&sort=list_updated_at&limit=100&${query}`, {
      token,
      priority,
    }),
  ]);

  const entries = new Map<number, MalEntry>();
  for (const entry of [...watching, ...recentlyCompleted.data]) {
    if (entry.list_status.status === 'watching' || entry.list_status.is_rewatching) {
      entries.set(entry.node.id, entry);
    }
  }
  return [...entries.values()];
}

/*
 * Plan-to-watch lists change rarely and can be large, so anonymous reads are kept a while, apart
 * from the public cache, as AniList's planning lists are
 */
const planningCache = new Map<string, { entries: MalEntry[]; expiresAt: number }>();
const PLANNING_TTL_MS = 5 * 60 * 1000;
const MAX_PLANNING_LISTS = 20;

/**
 * A user's "Plan to Watch" list, with what its posters show, so the anime needn't be looked up on
 * AniList: their own with their token, or anyone's public list by name. Anonymous reads are kept
 * for five minutes. Like AniList's, it gives way to watching lists and saves when the budget runs low
 */
export async function getPlanToWatchEntries(userName: string, token?: string): Promise<MalEntry[]> {
  // MyAnimeList names ignore case
  const key = userName.toLowerCase();
  if (!token) {
    const cached = planningCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.entries;
  }
  // One spelling, so simultaneous reads of the list share one request
  const path = `${API_URL}/users/${token ? '@me' : encodeURIComponent(key)}/animelist`;
  const fields = 'list_status,nsfw,num_episodes,status,mean,alternative_titles,genres,start_season';
  const entries = await readPages(
    `${path}?status=plan_to_watch&limit=1000&fields=${fields}&nsfw=true`,
    token,
    { cacheMs: 0, priority: 'optional' }
  );
  if (!token) {
    planningCache.delete(key);
    if (planningCache.size >= MAX_PLANNING_LISTS)
      planningCache.delete(planningCache.keys().next().value!);
    planningCache.set(key, { entries, expiresAt: Date.now() + PLANNING_TTL_MS });
  }
  return entries;
}

/*
 * Taste profiles are read for links anyone can share, so each is kept a while, apart from the
 * public cache, as AniList's are
 */
const tasteCache = new Map<string, { profile: TasteProfile; expiresAt: number }>();
const TASTE_TTL_MS = 10 * 60 * 1000;
const MAX_TASTE_PROFILES = 50;

/**
 * What someone thinks of the anime on their public list, to compare tastes, from their whole list:
 * a request per 1,000 anime. Like AniList's, it's read anonymously, as comparisons are public and
 * cached for anyone, and it's the first read to give way when MyAnimeList is busy. Its anime keep
 * MyAnimeList's ids only, as AniList would need a request per 50 to give its own; and as
 * MyAnimeList says neither whose list it is nor how they spell their name, the name is as asked for
 */
export async function getTasteProfile(userName: string): Promise<TasteProfile> {
  // Anyone can ask for any name, and a name that can't exist would still spend a request
  if (!isUserName(userName)) throw new MalNotFoundError(`No MyAnimeList user named ${userName}`);
  // MyAnimeList ignores case in names, so every spelling shares one read
  const key = userName.toLowerCase();
  const cached = tasteCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  const entries = await readPages(
    `${API_URL}/users/${encodeURIComponent(key)}/animelist?limit=1000&fields=list_status,nsfw,status,mean&nsfw=true`,
    undefined,
    { cacheMs: 0, priority: 'spare' }
  );

  const profile: TasteProfile = {
    domain: 'myanimelist',
    id: null,
    name: key,
    avatarUrl: null,
    // MyAnimeList scores are whole numbers out of 10
    scoreFormat: 'POINT_10',
    scored: [],
    seen: [],
    planned: [],
  };
  for (const { node, list_status } of entries) {
    const anime = {
      id: null,
      malId: node.id,
      title: node.title,
      coverUrl: node.main_picture?.medium ?? null,
      isAdult: node.nsfw === 'black',
      // Out of 10 with two decimals on MyAnimeList, out of 100 like AniList's here
      meanScore: node.mean ? Math.round(node.mean * 10) : null,
    };
    if (list_status.status === 'plan_to_watch') {
      // Nobody can start one that hasn't aired yet, alone or with friends
      if (node.status !== 'not_yet_aired') profile.planned.push(anime);
    } else if (list_status.score > 0) {
      const { score } = list_status;
      profile.scored.push({ ...anime, score, score100: toScore100(score, profile.scoreFormat) });
    } else profile.seen.push({ id: null, malId: node.id });
  }

  tasteCache.delete(key);
  if (tasteCache.size >= MAX_TASTE_PROFILES) tasteCache.delete(tasteCache.keys().next().value!);
  tasteCache.set(key, { profile, expiresAt: Date.now() + TASTE_TTL_MS });
  return profile;
}

/** Every anime on the token owner's list, whatever its status */
export function getAllEntries(token: string): Promise<MalEntry[]> {
  return readPages(
    `${API_URL}/users/@me/animelist?fields=list_status,nsfw&limit=1000&nsfw=true`,
    token
  );
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
 * An AniList list status in MyAnimeList's terms. MyAnimeList keeps a rewatch as a completed anime
 * being watched again
 */
export function toMalStatus(status: string): { status: MalListStatus; is_rewatching: boolean } {
  if (status === 'REPEATING') return { status: 'completed', is_rewatching: true };
  const malStatus = Object.entries(ANILIST_STATUSES).find(([, aniList]) => aniList === status);
  return { status: (malStatus?.[0] as MalListStatus) ?? 'watching', is_rewatching: false };
}

/**
 * Sets the token owner's entry to what was saved on AniList: its episode count and status, and its
 * score (from 1 to 10, 0 clearing it) and dates when given. An anime not yet on the list is added. A rewatch
 * AniList just finished counts as one more time watched, as on AniList, which takes a read of the
 * entry first; a sync, which copies whole entries rather than what just happened, leaves the count
 * alone and makes a single request
 */
export async function copyEntry(
  token: string,
  malId: number,
  entry: {
    progress: number;
    status: string;
    score?: number;
    startedAt?: string | null;
    completedAt?: string | null;
  },
  { countRewatch = true, priority }: { countRewatch?: boolean; priority?: RequestPriority } = {}
): Promise<void> {
  const { status, is_rewatching } = toMalStatus(entry.status);
  const body = new URLSearchParams({
    num_watched_episodes: String(entry.progress),
    status,
    is_rewatching: String(is_rewatching),
  });
  if (countRewatch && entry.status === 'COMPLETED') {
    const { my_list_status: current } = await request<{
      my_list_status?: Pick<MalListStatusData, 'is_rewatching' | 'num_times_rewatched'>;
    }>(`${API_URL}/anime/${malId}?fields=my_list_status{is_rewatching,num_times_rewatched}`, {
      token,
      priority,
    });
    if (current?.is_rewatching) {
      body.set('num_times_rewatched', String((current.num_times_rewatched ?? 0) + 1));
    }
  }
  if (entry.score !== undefined) body.set('score', String(entry.score));
  // A date is only ever set: one MyAnimeList has and the copy doesn't stays
  if (entry.startedAt) body.set('start_date', entry.startedAt);
  if (entry.completedAt) body.set('finish_date', entry.completedAt);
  await request(`${API_URL}/anime/${malId}/my_list_status`, {
    token,
    method: 'PATCH',
    body,
    priority,
  });
}

/**
 * Moves an anime on the token owner's list to "Watching", adding it when it isn't there, in one
 * request. The episode count, score and dates stay as they are
 */
export async function startWatching(
  token: string,
  malId: number
): Promise<{
  progress: number;
  score: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}> {
  const saved = await request<MalListStatusData>(`${API_URL}/anime/${malId}/my_list_status`, {
    token,
    method: 'PATCH',
    body: new URLSearchParams({ status: 'watching' }),
  });
  return {
    progress: saved.num_episodes_watched,
    score: saved.score,
    status: toAniListStatus(saved),
    startedAt: saved.start_date ?? null,
    completedAt: saved.finish_date ?? null,
  };
}

/**
 * Updates the token owner's own list entry: the watched episode count, the score (from 1 to 10, 0
 * clearing it), or both. What isn't given is left as it is. Unlike AniList, MyAnimeList doesn't
 * finish an anime when its last episode is watched, so this does, as AniList would: a rewatch ends
 * and counts as one more time watched. An anime not yet on the list is added as watching. That takes
 * reading the entry first, which the page's own count of the anime's `episodes` saves when this
 * save can't finish it
 */
export async function saveEntry(
  token: string,
  malId: number,
  changes: { progress?: number; score?: number },
  { episodes }: { episodes?: number } = {}
): Promise<{
  progress: number;
  score: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}> {
  const body = new URLSearchParams();
  if (changes.progress !== undefined) body.set('num_watched_episodes', String(changes.progress));
  // Only a new episode count can finish the anime, so only then may its details be needed. The card
  // the save comes from is on the list, so with fewer episodes than the anime has, nothing else
  // changes. Whether it finishes is MyAnimeList's to say, by its own count
  if (changes.progress !== undefined && (!episodes || changes.progress >= episodes)) {
    const anime = await request<{
      num_episodes: number;
      my_list_status?: Pick<MalListStatusData, 'is_rewatching' | 'num_times_rewatched'>;
    }>(
      `${API_URL}/anime/${malId}?fields=num_episodes,my_list_status{status,is_rewatching,num_times_rewatched}`,
      { token }
    );
    const current = anime.my_list_status;
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
    startedAt: saved.start_date ?? null,
    completedAt: saved.finish_date ?? null,
  };
}
