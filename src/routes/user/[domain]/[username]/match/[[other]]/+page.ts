import { error, redirect } from '@sveltejs/kit';

import { matchPath, parseUserName } from '#lib/match.js';
import { isDomain } from '#lib/types/domain.js';

import type { PageLoad } from './$types';

/**
 * The page never waits on AniList: both lists are read in the browser, from profiles the CDN keeps
 * (see /api/taste). A name typed in the form arrives as `?with=`, and a signed-in viewer opening
 * someone's invitation is compared with them right away. Nobody is compared with themselves: that
 * is the invitation, with a note when they typed their own name
 */
export const load: PageLoad = async ({ params, parent, url }) => {
  if (!isDomain(params.domain)) error(404, `Unknown domain: ${params.domain}`);
  const page = { name: params.username, other: null, invalidName: null, same: false };
  const isOwner = (name: string) => name.toLowerCase() === params.username.toLowerCase();

  const typed = url.searchParams.get('with');
  if (typed !== null) {
    const other = parseUserName(typed);
    if (!other) return { ...page, invalidName: typed };
    if (isOwner(other)) return { ...page, same: true };
    redirect(303, matchPath(params.username, other));
  }

  if (params.other) {
    if (isOwner(params.other)) redirect(307, matchPath(params.username));
    return { ...page, other: params.other };
  }

  const { user } = await parent();
  if (user && !isOwner(user.name)) redirect(307, matchPath(params.username, user.name));
  return page;
};
