import { browser } from '$app/env';
import { error } from '@sveltejs/kit';

import { hiddenSectionsInBrowser } from '#lib/hidden-sections.js';

import type { PageLoad } from './$types';

type ListData = Exclude<Parameters<PageLoad>[0]['data'], { unavailable: true }>;

/*
 * The list this browser last showed. When AniList doesn't answer as the list reloads, by itself or
 * after a save, the page keeps showing it; the next reload catches up
 */
let lastShown: ListData | null = null;

export const load: PageLoad = ({ data }) => {
  // In the browser, the filters as they are now: the server read them as the load started, and the
  // viewer may have changed them while it ran
  const hiddenSections = browser ? hiddenSectionsInBrowser(document.cookie) : data.hiddenSections;
  if ('unavailable' in data) {
    if (browser && lastShown?.username.toLowerCase() === data.username.toLowerCase()) {
      return { ...lastShown, hiddenSections };
    }
    error(503, "AniList isn't answering right now, please try again in a moment");
  }
  if (browser) lastShown = data;
  return { ...data, hiddenSections };
};
