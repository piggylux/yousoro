import { error, redirect } from '@sveltejs/kit';

import {
  canCompare,
  matchPath,
  pagePerson,
  parsePerson,
  parsePersonSegment,
  sameName,
  viewerAccounts,
} from '#lib/match.js';
import type { ListOwner } from '#lib/types/domain.js';

import type { PageLoad } from './$types';

/**
 * The page never waits on AniList or MyAnimeList: both lists are read in the browser, from profiles
 * the CDN keeps (see /api/taste). A name typed in the form arrives as `?with=`, and a signed-in
 * viewer opening someone's invitation is compared with them right away, with their account on the
 * same service when they have one. Nobody is compared with themselves: that is the invitation, with
 * a note when they typed their own name
 */
export const load: PageLoad = async ({ params, parent, url }) => {
  const { user, malUser, malEnabled } = await parent();
  const owner = pagePerson(params.domain, params.username, malEnabled);
  if (!owner) error(404, `Unknown domain: ${params.domain}`);
  const page = {
    owner,
    other: null as ListOwner | null,
    invalidName: null as string | null,
    same: false,
  };

  const typed = url.searchParams.get('with');
  if (typed !== null) {
    const other = parsePerson(typed, owner.domain);
    if (!other || !canCompare(other, malEnabled)) return { ...page, invalidName: typed };
    if (sameName(owner, other)) return { ...page, same: true };
    redirect(303, matchPath(owner, other));
  }

  if (params.other) {
    const other = parsePersonSegment(params.other, owner.domain);
    if (!other || !canCompare(other, malEnabled)) {
      error(404, `There's nobody to compare with at ${params.other}`);
    }
    if (sameName(owner, other)) redirect(307, matchPath(owner));
    return { ...page, other };
  }

  const viewer = viewerAccounts(user, malUser, owner.domain);
  if (viewer.length && !viewer.some((account) => sameName(account, owner))) {
    redirect(307, matchPath(owner, viewer[0]));
  }
  return page;
};
