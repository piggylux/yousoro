import { browser } from '$app/env';
import { error } from '@sveltejs/kit';

import { withoutHiddenMature } from '#lib/anime.js';
import { hiddenSectionsInBrowser } from '#lib/hidden-sections.js';
import {
  getRememberedList,
  rememberList,
  getFreshList,
  setListContext,
  getListContext,
  getSaveRevision,
  reconcileSavedEntries,
} from '#lib/list-data.js';
import { retryAfterSeconds } from '#lib/read-retry.js';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data: serverData, parent, fetch, url }) => {
  const { preferences, user } = await parent();
  if (browser) setListContext(user?.id ?? null, preferences.showMature);
  const context = getListContext();
  const revision = getSaveRevision();
  let data: Exclude<typeof serverData, { deferred: true }>;
  if ('deferred' in serverData) {
    const cached = browser
      ? getFreshList(serverData.username, url.searchParams.get('view') !== 'calendar')
      : null;
    if (cached) return { ...cached, hiddenSections: hiddenSectionsInBrowser(document.cookie) };
    try {
      const query = url.searchParams.get('view') === 'calendar' ? '?view=calendar' : '';
      const response = await fetch(`/api/list/${encodeURIComponent(serverData.username)}${query}`);
      if (response.status === 404)
        error(404, `There's no AniList user named ${serverData.username}`);
      if (response.status === 429) {
        data = {
          unavailable: true,
          username: serverData.username,
          hiddenSections: [],
          retryAt: Date.now() + retryAfterSeconds(response.headers.get('Retry-After')) * 1000,
        };
      } else {
        if (!response.ok) throw new Error('List unavailable');
        data = await response.json();
      }
      if (!('unavailable' in data))
        data.watchingList = data.watchingList.map((anime) => ({
          ...anime,
          endDate: new Date(anime.endDate ?? NaN),
        }));
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 404) throw err;
      data = { unavailable: true, username: serverData.username, hiddenSections: [], retryAt: 0 };
    }
  } else data = serverData;
  // In the browser, the filters as they are now: the server read them as the load started, and the
  // viewer may have changed them while it ran
  const hiddenSections = browser ? hiddenSectionsInBrowser(document.cookie) : data.hiddenSections;
  if ('unavailable' in data) {
    const lastShown = browser ? getRememberedList(data.username) : null;
    if (lastShown) {
      return {
        ...lastShown,
        watchingList: withoutHiddenMature(lastShown.watchingList, preferences.showMature),
        hiddenSections,
        retryAt: data.retryAt,
      };
    }
    if (data.retryAt)
      error(429, {
        message: 'AniList is busy. Your list will retry shortly.',
        retryAt: data.retryAt,
      });
    error(503, "AniList isn't answering right now, please try again in a moment");
  }
  if (browser && context === getListContext()) {
    data = reconcileSavedEntries(data, revision);
    rememberList(data);
  }
  return { ...data, hiddenSections };
};
