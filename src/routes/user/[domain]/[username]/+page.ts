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
  viewerKey,
  getSaveRevision,
  reconcileSavedEntries,
} from '#lib/list-data.js';
import { retryAfterSeconds } from '#lib/read-retry.js';
import { DOMAIN_NAMES, isDomain } from '#lib/types/domain.js';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data: serverData, parent, fetch, url, params }) => {
  const { preferences, user, malUser } = await parent();
  if (browser) setListContext(viewerKey(user, malUser), preferences.showMature);
  // The server load has already turned away any other domain
  const domain = isDomain(params.domain) ? params.domain : 'anilist';
  const service = DOMAIN_NAMES[domain];
  const context = getListContext();
  const revision = getSaveRevision();
  let data: Exclude<typeof serverData, { deferred: true }>;
  if ('deferred' in serverData) {
    const cached = browser
      ? getFreshList(serverData.username, url.searchParams.get('view') !== 'calendar', domain)
      : null;
    if (cached) return { ...cached, hiddenSections: hiddenSectionsInBrowser(document.cookie) };
    try {
      const query = url.searchParams.get('view') === 'calendar' ? '?view=calendar' : '';
      const response = await fetch(
        `/api/list/${domain}/${encodeURIComponent(serverData.username)}${query}`
      );
      // A list that doesn't exist or isn't shared, with the server's explanation
      if (response.status === 403 || response.status === 404) {
        const body = await response.json().catch(() => null);
        error(
          response.status,
          body?.message ?? `There's no ${service} user named ${serverData.username}`
        );
      }
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
      if (
        err &&
        typeof err === 'object' &&
        'status' in err &&
        [403, 404].includes(err.status as number)
      )
        throw err;
      data = { unavailable: true, username: serverData.username, hiddenSections: [], retryAt: 0 };
    }
  } else data = serverData;
  // In the browser, the filters as they are now: the server read them as the load started, and the
  // viewer may have changed them while it ran
  const hiddenSections = browser ? hiddenSectionsInBrowser(document.cookie) : data.hiddenSections;
  if ('unavailable' in data) {
    const lastShown = browser ? getRememberedList(data.username, domain) : null;
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
        message: `${service} is busy. Your list will retry shortly.`,
        retryAt: data.retryAt,
      });
    error(503, `${service} isn't answering right now, please try again in a moment`);
  }
  if (browser && context === getListContext()) {
    data = reconcileSavedEntries(data, revision);
    rememberList(data);
  }
  return { ...data, hiddenSections };
};
