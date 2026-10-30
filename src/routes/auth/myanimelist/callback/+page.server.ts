import { error, redirect } from '@sveltejs/kit';

import { finishSignIn, MAL_ENABLED, MalSignInError } from '#lib/server/myanimelist-auth.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { setMalSession } from '#lib/server/session.js';

import type { PageServerLoad } from './$types';

/** Where MyAnimeList sends the browser back to, with a code the server turns into a session */
export const load: PageServerLoad = async ({ url, cookies, getClientAddress, locals }) => {
  if (!MAL_ENABLED) error(404, 'MyAnimeList sign-in is not available on this site');
  const limit = await takeClientLimit(getClientAddress(), 'auth');
  if (!limit.allowed) {
    locals.retryAfter = limit.retryAfter;
    error(429, 'Too many sign-in attempts, please try again shortly');
  }

  let result;
  try {
    result = await finishSignIn(cookies, url);
  } catch (err) {
    if (err instanceof MalSignInError) return { errorMessage: err.message };
    console.error(err);
    return { errorMessage: 'MyAnimeList sign-in failed, please try again' };
  }
  setMalSession(cookies, result.session);
  redirect(303, result.redirectTo);
};
