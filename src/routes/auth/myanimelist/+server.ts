import { error, redirect } from '@sveltejs/kit';

import { MAL_ENABLED, startSignIn } from '#lib/server/myanimelist-auth.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { safeRedirectPath } from '#lib/server/redirect.js';

import type { RequestHandler } from './$types';

/**
 * Sends the browser to MyAnimeList to sign in. A plain link starts it, as the Content-Security-Policy
 * only lets forms post to this site. Starting a sign-in for someone else only takes them to
 * MyAnimeList, where they sign in as themselves
 */
export const GET: RequestHandler = async ({ url, cookies, getClientAddress, locals }) => {
  if (!MAL_ENABLED) error(404, 'MyAnimeList sign-in is not available on this site');
  const limit = await takeClientLimit(getClientAddress(), 'auth');
  if (!limit.allowed) {
    locals.retryAfter = limit.retryAfter;
    error(429, 'Too many sign-in attempts, please try again shortly');
  }
  const redirectTo = safeRedirectPath(url.searchParams.get('redirectTo'));
  redirect(303, startSignIn(cookies, url.origin, redirectTo), {
    external: ['https://myanimelist.net'],
  });
};
