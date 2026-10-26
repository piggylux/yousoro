import type { Anime } from '#lib/types/anime.js';
import type { AnimePageData } from '#lib/types/api.js';

// Used only in browser load functions and event handlers, never populated during SSR.
type ListData = Omit<AnimePageData, 'preferences'>;
let lastShown: ListData | null = null;

export function rememberList(data: ListData) {
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
  };
}

export function getRememberedList(username: string) {
  return lastShown?.username.toLowerCase() === username.toLowerCase() ? lastShown : null;
}

/** Apply the provider's confirmed result to both the visible list and its refresh fallback. */
export function recordSavedEntry<T extends ListData>(data: T, saved: Anime, status?: string): T {
  const updated = {
    ...data,
    watchingList: data.watchingList.flatMap((anime) => {
      if (anime.id !== saved.id) return [anime];
      return status === 'COMPLETED' ? [] : [{ ...saved, lastUpdatedAt: Date.now() }];
    }),
  };
  rememberList(updated);
  return updated;
}
