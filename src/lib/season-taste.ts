import { retryAfterSeconds } from '#lib/read-retry.js';
import { OTHER_LISTS, type ListMove, type OtherList } from '#lib/types/api.js';
import type { SeasonTastePageData } from '#lib/types/season.js';

/**
 * A list owner's taste, as the season page reads it in the browser: once, and again only after
 * five minutes, or once an anime moved in a way this tab can't tell, so switching seasons or
 * coming back to the page asks nothing of AniList or MyAnimeList. Kept per viewer, as the owner
 * reads their own private entries
 */
export type SeasonTasteState =
  | { status: 'loading' }
  | { status: 'ready'; taste: SeasonTastePageData }
  /** No such user, or their list is private: why, as the server said it */
  | { status: 'missing'; message: string }
  /** The service is busy until `retryAt`, as Unix time in ms */
  | { status: 'busy'; retryAt: number }
  | { status: 'failed' };

const remembered = new Map<string, { taste: SeasonTastePageData; expiresAt: number }>();
const REMEMBER_MS = 5 * 60 * 1000;
const MAX_REMEMBERED = 10;
const listKey = (domain: string, username: string) => `${domain}:${username.toLowerCase()}`;

export async function loadSeasonTaste(
  viewer: string | null,
  domain: string,
  username: string,
  fetcher: typeof fetch = fetch
): Promise<Exclude<SeasonTasteState, { status: 'loading' }>> {
  const key = `${viewer}:${listKey(domain, username)}`;
  const saved = remembered.get(key);
  if (saved && saved.expiresAt > Date.now()) return { status: 'ready', taste: saved.taste };
  remembered.delete(key);
  try {
    const response = await fetcher(
      `/api/season-taste/${encodeURIComponent(domain)}/${encodeURIComponent(username)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (response.ok) {
      const taste: SeasonTastePageData = await response.json();
      if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!);
      remembered.set(key, { taste, expiresAt: Date.now() + REMEMBER_MS });
      return { status: 'ready', taste };
    }
    const body: App.Error | null = await response.json().catch(() => null);
    if (response.status === 404 || response.status === 403) {
      return { status: 'missing', message: body?.message ?? `There's no list named ${username}` };
    }
    if (response.status === 429) {
      const retryAt =
        body?.retryAt ?? Date.now() + retryAfterSeconds(response.headers.get('Retry-After')) * 1000;
      return { status: 'busy', retryAt };
    }
  } catch {
    // Offline, or the answer wasn't readable: the same as the service not answering
  }
  return { status: 'failed' };
}

/**
 * Moves an anime on the lists the tab remembers for a list, once the owner added it from the season
 * page, so coming back shows it where it went without reading the list again. `id` is the list's
 * own service's id for it
 */
export function rememberTasteMove(domain: string, username: string, id: number, list: ListMove) {
  const suffix = `:${listKey(domain, username)}`;
  for (const [key, saved] of remembered) {
    if (!key.endsWith(suffix)) continue;
    const { taste } = saved;
    const listedIds = Object.fromEntries(
      OTHER_LISTS.map((other) => [
        other,
        [
          ...(taste.listedIds[other] ?? []).filter((listed) => listed !== id),
          ...(other === list ? [id] : []),
        ],
      ])
    ) as Record<OtherList, number[]>;
    const watching = taste.watching.filter((entry) => entry.id !== id);
    if (list === 'CURRENT') watching.push({ id, progress: 0, rewatching: false });
    remembered.set(key, { ...saved, taste: { ...taste, listedIds, watching } });
  }
}

/**
 * Forgets what the tab remembers of a list's taste, as when an add was undone and the anime went
 * back to wherever it was, so the season page reads it again
 */
export function forgetSeasonTaste(domain: string, username: string) {
  const suffix = `:${listKey(domain, username)}`;
  for (const key of remembered.keys()) if (key.endsWith(suffix)) remembered.delete(key);
}

/** Forgets every taste read; for tests */
export function forgetSeasonTastes() {
  remembered.clear();
}
