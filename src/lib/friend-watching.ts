import { retryAfterSeconds } from '#lib/read-retry.js';
import type { Anime } from '#lib/types/anime.js';
import type {
  FriendWatching,
  FriendWatchingResult,
  FriendsLookupState,
  SharedAnime,
} from '#lib/types/friend-watching.js';
import type { SessionUser } from '#lib/types/session-user.js';

const TTL = 5 * 60 * 1000;

/** Presentation-only exclusion: keep the shared cache usable on other people's lists. */
export function withoutListOwner(matches: FriendWatchingResult['matches'], ownerName: string) {
  const owner = ownerName.toLowerCase();
  return Object.fromEntries(
    Object.entries(matches).map(([id, friends]) => [
      id,
      friends.filter((friend) => friend.name.toLowerCase() !== owner),
    ])
  );
}
let viewer: number | null = null;
let generation = 0;
const covered = new Map<
  number,
  { expiresAt: number; friends: FriendWatchingResult['matches'][number] }
>();
const requests = new Map<string, Promise<FriendWatchingResult>>();
const partials = new Map<string, { expiresAt: number; result: FriendWatchingResult }>();
let ownAnime: { expiresAt: number; anime: SharedAnime[]; complete: boolean } | null = null;
let ownRequest: Promise<SharedAnime[]> | null = null;
let retryAt = 0;
let ownRevision = 0;
const ownUpdates = new Map<
  number,
  {
    revision: number;
    expiresAt: number;
    person: FriendWatching | null;
    anime: SharedAnime;
  }
>();

export function setFriendsViewer(id: number | null) {
  if (viewer === id) return;
  viewer = id;
  generation++;
  covered.clear();
  requests.clear();
  partials.clear();
  ownAnime = null;
  ownRequest = null;
  retryAt = 0;
  ownUpdates.clear();
  ownRevision = 0;
}

export class FriendsUnavailable extends Error {
  constructor(
    message: string,
    public retryAt = 0
  ) {
    super(message);
  }
}

async function responseData(response: Response, version: number) {
  // Errors from a previous account must not clear the current account or set its cooldown.
  if (version !== generation) throw new FriendsUnavailable('Account changed.');
  const retry = response.headers.get('Retry-After');
  if (response.status === 429 || (response.ok && retry))
    retryAt = Math.max(retryAt, Date.now() + retryAfterSeconds(retry) * 1000);
  if (response.ok) return response.json();
  if (response.status === 401) setFriendsViewer(null);
  throw new FriendsUnavailable(
    response.status === 401
      ? 'Sign in again to see friends watching.'
      : 'Friends watching is unavailable.',
    response.status === 429 ? retryAt : 0
  );
}

function replaceViewer(people: FriendWatching[], id: number, person: FriendWatching | null) {
  const others = people.filter((entry) => entry.id !== id);
  return person ? [person, ...others] : others;
}

/** Patch only the signed-in user's confirmed entry, without refreshing anyone else's data. */
export function recordOwnWatchingEntry(user: SessionUser, saved: Anime, status: string) {
  if (viewer !== user.id) return;
  const watching = !status || status === 'CURRENT' || status === 'REPEATING';
  const person: FriendWatching | null = watching
    ? {
        ...user,
        progress: saved.currentEpisode,
        rewatching: status ? status === 'REPEATING' : saved.rewatching,
        isViewer: true,
      }
    : null;
  const anime = {
    id: saved.id,
    title: saved.title,
    isAdult: saved.isAdult,
    coverUrl: saved.thumbnailUrl,
  };
  ownUpdates.set(saved.id, { revision: ++ownRevision, expiresAt: Date.now() + TTL, person, anime });
  const cached = covered.get(saved.id);
  if (cached) cached.friends = replaceViewer(cached.friends, user.id, person);
  for (const [key, partial] of partials) {
    if (key.split(',').includes(String(saved.id))) {
      partial.result.matches[saved.id] = replaceViewer(
        partial.result.matches[saved.id] ?? [],
        user.id,
        person
      );
    }
  }
  if (ownAnime) {
    ownAnime.anime = ownAnime.anime.filter((entry) => entry.id !== saved.id);
    if (person) ownAnime.anime.push(anime);
  }
}

function newerOwnUpdates(revision: number) {
  for (const [id, update] of ownUpdates) {
    if (update.expiresAt <= Date.now()) ownUpdates.delete(id);
  }
  return [...ownUpdates].filter(([, update]) => update.revision > revision);
}

function applyOwnUpdates(result: FriendWatchingResult, ids: number[], revision: number) {
  if (viewer === null) return;
  const requested = new Set(ids);
  for (const [id, update] of newerOwnUpdates(revision)) {
    if (requested.has(id))
      result.matches[id] = replaceViewer(result.matches[id] ?? [], viewer, update.person);
  }
}

function checkRetry() {
  if (retryAt > Date.now())
    throw new FriendsUnavailable('Please wait before trying again.', retryAt);
}

export function seedOwnAnime(
  id: number,
  anime: (SharedAnime & { thumbnailUrl?: string })[],
  complete = true
) {
  setFriendsViewer(id);
  ownAnime = {
    anime: anime.map((entry) => ({ ...entry, coverUrl: entry.coverUrl ?? entry.thumbnailUrl })),
    complete,
    expiresAt: Date.now() + TTL,
  };
}

export async function getOwnSharedAnime(id: number, showMature = true): Promise<SharedAnime[]> {
  setFriendsViewer(id);
  if (ownAnime && ownAnime.expiresAt > Date.now() && (ownAnime.complete || !showMature))
    return ownAnime.anime;
  checkRetry();
  if (ownRequest) return ownRequest;
  const version = generation;
  const revision = ownRevision;
  const pending = fetch('/api/friends/watching')
    .then((response) => responseData(response, version))
    .then((anime: SharedAnime[]) => {
      if (version !== generation) throw new FriendsUnavailable('Account changed.');
      for (const [id, update] of newerOwnUpdates(revision)) {
        anime = anime.filter((entry) => entry.id !== id);
        if (update.person) anime.push(update.anime);
      }
      ownAnime = { anime, complete: true, expiresAt: Date.now() + TTL };
      return anime;
    })
    .finally(() => {
      if (ownRequest === pending) ownRequest = null;
    });
  ownRequest = pending;
  return pending;
}

export async function loadFriendsWatching(
  id: number,
  mediaIds: number[]
): Promise<FriendWatchingResult> {
  setFriendsViewer(id);
  const version = generation;
  const startingRevision = ownRevision;
  for (const [mediaId, cached] of covered) {
    if (cached.expiresAt <= Date.now()) covered.delete(mediaId);
  }
  for (const [key, cached] of partials) {
    if (cached.expiresAt <= Date.now()) partials.delete(key);
  }
  const ids = [...new Set(mediaIds)].sort((a, b) => a - b);
  const missing = ids.filter((mediaId) => (covered.get(mediaId)?.expiresAt ?? 0) <= Date.now());
  const result: FriendWatchingResult = { matches: {}, partial: false };
  for (const mediaId of ids) {
    const cached = covered.get(mediaId);
    if (cached && cached.expiresAt > Date.now()) result.matches[mediaId] = cached.friends;
  }
  // Large lists are split only at the endpoint's input limit, never per card or per friend.
  for (let start = 0; start < missing.length; start += 500) {
    if (version !== generation) throw new FriendsUnavailable('Account changed.');
    const batch = missing.slice(start, start + 500);
    const key = batch.join(',');
    const partial = partials.get(key);
    let data: FriendWatchingResult;
    if (partial && partial.expiresAt > Date.now())
      data = partial.result.retryAfter
        ? {
            ...partial.result,
            retryAfter: Math.max(1, Math.ceil((partial.expiresAt - Date.now()) / 1000)),
          }
        : partial.result;
    else {
      checkRetry();
      let pending = requests.get(key);
      if (!pending) {
        const revision = ownRevision;
        pending = fetch('/api/friends/watching', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaIds: batch }),
        })
          .then((response) => responseData(response, version))
          .then((value: FriendWatchingResult) => {
            if (version !== generation) throw new FriendsUnavailable('Account changed.');
            applyOwnUpdates(value, batch, revision);
            const expiresAt = Date.now() + TTL;
            if (value.partial)
              partials.set(key, {
                expiresAt: value.retryAfter ? Date.now() + value.retryAfter * 1000 : expiresAt,
                result: value,
              });
            else
              for (const mediaId of batch) {
                covered.set(mediaId, { expiresAt, friends: value.matches[mediaId] ?? [] });
              }
            return value;
          })
          .finally(() => {
            if (requests.get(key) === pending) requests.delete(key);
          });
        requests.set(key, pending);
      }
      data = await pending;
    }
    if (version !== generation) throw new FriendsUnavailable('Account changed.');
    Object.assign(result.matches, data.matches);
    result.partial ||= data.partial;
    if (data.retryAfter) {
      result.retryAfter = Math.max(result.retryAfter ?? 0, data.retryAfter);
      // Preserve earlier batches instead of throwing when the next batch checks the cooldown.
      break;
    }
  }
  applyOwnUpdates(result, ids, startingRevision);
  return result;
}

/** Both the loader and its parent receive an explicit terminal state after a failed request. */
export async function runFriendsLookup(
  id: number,
  mediaIds: number[],
  update: (state: FriendsLookupState) => void
) {
  update({ status: 'loading' });
  let state: FriendsLookupState;
  try {
    state = { status: 'ready', result: await loadFriendsWatching(id, mediaIds) };
  } catch (error) {
    state = {
      status: 'unavailable',
      message:
        error instanceof FriendsUnavailable ? error.message : 'Friends watching is unavailable.',
      retryAt: error instanceof FriendsUnavailable ? error.retryAt : 0,
    };
  }
  update(state);
}
