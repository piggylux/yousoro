import { browser } from '$app/env';
import { error } from '@sveltejs/kit';

import { withoutHiddenMature } from '#lib/anime.js';
import { hiddenSectionsInBrowser } from '#lib/hidden-sections.js';
import { getRememberedList, rememberList } from '#lib/list-data.js';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, parent }) => {
  // In the browser, the filters as they are now: the server read them as the load started, and the
  // viewer may have changed them while it ran
  const hiddenSections = browser ? hiddenSectionsInBrowser(document.cookie) : data.hiddenSections;
  if ('unavailable' in data) {
    const lastShown = browser ? getRememberedList(data.username) : null;
    if (lastShown) {
      const { preferences } = await parent();
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
  if (browser) rememberList(data);
  return { ...data, hiddenSections };
};
