import type { Anime } from '#lib/types/anime.js';
import type { AnimePageData } from '#lib/types/api.js';

// Used only in browser load functions and event handlers, never populated during SSR.
type ListData = Omit<AnimePageData, 'preferences'>;
let lastShown: ListData | null = null;
let viewerId: number | null = null;
let matureContext = true;
let contextRevision = 0;
let saveRevision = 0;
const confirmedEntries = new Map<
  string,
  { revision: number; saved: Anime; status?: string; expiresAt: number }
>();
const freshLists = new Map<string, { data: ListData; expiresAt: number }>();
const keyFor = (username: string) => `${username.toLowerCase()}:${matureContext}`;
export const getListContext = () => `${viewerId}:${matureContext}:${contextRevision}`;
export const getSaveRevision = () => saveRevision;

export function setListContext(id: number | null, showMature: boolean) {
  if (viewerId !== id || matureContext !== showMature) contextRevision++;
  if (viewerId !== id) {
    lastShown = null;
    freshLists.clear();
    confirmedEntries.clear();
    saveRevision = 0;
  }
  viewerId = id;
  matureContext = showMature;
}

export function expireRememberedList(username: string) {
  for (const key of freshLists.keys()) {
    if (key.startsWith(`${username.toLowerCase()}:`)) freshLists.delete(key);
  }
}

export function getFreshList(username: string, needAirings = true) {
  const saved = freshLists.get(keyFor(username));
  if (
    saved &&
    saved.expiresAt > Date.now() &&
    (!needAirings || saved.data.airingsEnriched !== false)
  ) {
    lastShown = saved.data;
    return saved.data;
  }
  return null;
}

export function rememberList(data: ListData, refresh = true) {
  // The fallback is page data only; root-layout preferences must stay current.
  const {
    domain,
    username,
    avatarUrl,
    canEdit,
    watchingList,
    scoreFormat,
    hiddenSections,
    userProfileLink,
    airingsEnriched,
  } = data;
  lastShown = {
    domain,
    username,
    avatarUrl,
    canEdit,
    watchingList,
    scoreFormat,
    hiddenSections,
    userProfileLink,
    airingsEnriched,
  };
  const key = keyFor(username);
  const previous = freshLists.get(key);
  if (freshLists.size >= 10 && !previous) freshLists.delete(freshLists.keys().next().value!);
  // Do not reuse a list across a known episode's airing boundary.
  const nextAiring = Math.min(
    ...watchingList.flatMap((anime) =>
      anime.nextEpisode && anime.nextEpisode.airsAt > Date.now() ? [anime.nextEpisode.airsAt] : []
    )
  );
  const expiresAt = refresh
    ? Math.min(Date.now() + 60_000, nextAiring)
    : (previous?.expiresAt ?? 0);
  freshLists.set(key, { data: lastShown, expiresAt });
}

export function getRememberedList(username: string) {
  return lastShown?.username.toLowerCase() === username.toLowerCase() ? lastShown : null;
}

function patchEntry<T extends ListData>(data: T, saved: Anime, status?: string): T {
  return {
    ...data,
    watchingList: data.watchingList.flatMap((anime) => {
      if (anime.id !== saved.id) return [anime];
      return status === 'COMPLETED'
        ? []
        : [
            {
              ...anime,
              currentEpisode: saved.currentEpisode,
              userScore: saved.userScore,
              lastUpdatedAt: saved.lastUpdatedAt,
              rewatching: status ? status === 'REPEATING' : saved.rewatching,
            },
          ];
    }),
  };
}

/** Reads started before a confirmed save must not restore its old progress or completed card. */
export function reconcileSavedEntries<T extends ListData>(data: T, revision: number): T {
  if (!data.canEdit) return data;
  const prefix = `${data.username.toLowerCase()}:`;
  for (const [key, confirmed] of confirmedEntries) {
    if (confirmed.expiresAt <= Date.now()) confirmedEntries.delete(key);
    else if (key.startsWith(prefix) && confirmed.revision > revision)
      data = patchEntry(data, confirmed.saved, confirmed.status);
  }
  return data;
}

/** Apply the provider's confirmed result to both the visible list and its refresh fallback. */
export function recordSavedEntry<T extends ListData>(data: T, saved: Anime, status?: string): T {
  saved = { ...saved, lastUpdatedAt: Date.now() };
  const key = `${data.username.toLowerCase()}:${saved.id}`;
  if (confirmedEntries.size >= 1000 && !confirmedEntries.has(key))
    confirmedEntries.delete(confirmedEntries.keys().next().value!);
  confirmedEntries.set(key, {
    saved,
    status,
    revision: ++saveRevision,
    expiresAt: Date.now() + 5 * 60_000,
  });
  // Patch every preference variant while retaining its original freshness deadline.
  for (const [cacheKey, cached] of freshLists) {
    if (cached.data.username.toLowerCase() === data.username.toLowerCase())
      freshLists.set(cacheKey, { ...cached, data: patchEntry(cached.data, saved, status) });
  }
  const updated = patchEntry(data, saved, status);
  rememberList(updated, false);
  return updated;
}
