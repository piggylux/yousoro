import { error, json } from '@sveltejs/kit';

import { getViewer } from '#lib/server/anilist-client.js';
import { safeRedirectPath } from '#lib/server/redirect.js';
import { isAccessToken, setSession } from '#lib/server/session.js';

import type { RequestHandler } from './$types';

/** Turns the token from the sign-in callback into a session cookie. */
export const POST: RequestHandler = async ({ request, cookies }) => {
  // JSON only: another site can't send JSON here without the browser asking first, and this route
  // never allows it, so nobody can sign a visitor in to the wrong account
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    error(415, 'Expected JSON');
  }

  const body = await request.json().catch(() => null);
  const token: unknown = body?.token;
  if (!isAccessToken(token)) {
    error(400, 'Invalid sign-in');
  }

  // Confirms the token is genuine and finds out whose it is
  let user;
  try {
    user = await getViewer(token);
  } catch (err) {
    console.error(err);
    error(401, 'AniList rejected the sign-in');
  }

  const expiresIn = Number(body.expiresIn);
  setSession(cookies, { token, user }, Number.isFinite(expiresIn) ? expiresIn : Infinity);
  return json({ redirectTo: safeRedirectPath(body.redirectTo) });
};
