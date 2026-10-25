import { browser } from '$app/env';
import { error } from '@sveltejs/kit';

import type { PageLoad } from './$types';

type ListData = Exclude<Parameters<PageLoad>[0]['data'], { unavailable: true }>;

/*
 * The list this browser last showed. When AniList doesn't answer as the list reloads, by itself or
 * after a save, the page keeps showing it; the next reload catches up
 */
let lastShown: ListData | null = null;

export const load: PageLoad = ({ data }) => {
  if ('unavailable' in data) {
    if (browser && lastShown?.username.toLowerCase() === data.username.toLowerCase()) {
      return lastShown;
    }
    error(503, "AniList isn't answering right now, please try again in a moment");
  }
  if (browser) lastShown = data;
  return data;
};
