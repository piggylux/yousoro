import { browser } from '$app/env';
import { error, redirect } from '@sveltejs/kit';

import { viewerKey } from '#lib/list-data.js';
import { getRememberedPlanned, rememberPlanned } from '#lib/planning.js';
import { linkedAccounts, signedInAccounts } from '#lib/profile-links.js';
import { retryAfterSeconds } from '#lib/read-retry.js';
import type { PlanningPageData } from '#lib/types/api.js';
import { DOMAIN_NAMES, isDomain, listPath } from '#lib/types/domain.js';

import type { PageLoad } from './$types';

/**
 * Plan lists are read through the API rather than a server load, so that coming back to one in the
 * same tab within a few minutes shows it from memory, without asking AniList or MyAnimeList for the
 * whole list again. On the first visit the server's read is sent with the page, so the browser
 * doesn't repeat it
 */
export const load: PageLoad = async ({ parent, fetch, params }) => {
  const { preferences, user, malUser } = await parent();
  const viewer = viewerKey(user, malUser);
  const { domain, username } = params;
  // Signed in to both services, the viewer's two plan lists show as one, on their main list
  const linked = isDomain(domain)
    ? linkedAccounts(
        { domain, name: username },
        signedInAccounts(user, malUser, preferences.mainList)
      )
    : null;
  if (linked && linked.main.domain !== domain) {
    redirect(303, `${listPath(linked.main.domain, linked.main.name)}/planning`);
  }
  if (browser) {
    const saved = getRememberedPlanned(viewer, preferences.showMature, domain, username);
    if (saved) return saved;
  }

  const response = await fetch(
    `/api/planning/${encodeURIComponent(domain)}/${encodeURIComponent(username)}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!response.ok) {
    const body: App.Error | null = await response.json().catch(() => null);
    const service = isDomain(domain) ? DOMAIN_NAMES[domain] : 'The service';
    if (response.status === 429) {
      error(429, {
        message: body?.message ?? `${service} is busy. The list will retry shortly.`,
        retryAt:
          body?.retryAt ??
          Date.now() + retryAfterSeconds(response.headers.get('Retry-After')) * 1000,
      });
    }
    error(
      response.status,
      body?.message ?? `${service} isn't answering right now, please try again in a moment`
    );
  }
  const data: PlanningPageData = await response.json();
  if (browser) rememberPlanned(viewer, preferences.showMature, username, data);
  return data;
};
