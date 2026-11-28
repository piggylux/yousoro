import { error, type Cookies } from '@sveltejs/kit';

import { STILL_READING, stillReading, within } from '#lib/first-load.js';
import {
  AniListNotFoundError,
  AniListRateLimitError,
  getFollowing,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({
  params,
  locals,
  getClientAddress,
  isDataRequest,
}: {
  params: { username: string; domain: string };
  locals: App.Locals;
  cookies: Cookies;
  getClientAddress: () => string;
  isDataRequest: boolean;
}) {
  if (params.domain !== 'anilist') {
    error(404, `Unknown domain: ${params.domain}`);
  }

  let result;
  try {
    const limit = await takeClientLimit(getClientAddress(), 'read');
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    // Following is public. Anonymous reads can reuse the five-minute public cache,
    // including while signed in; private lists and matches still use the viewer's token.
    const read = getFollowing(params.username, undefined, locals.session?.user);
    // A first load waits a moment, then shows the page in outline while the browser reads it,
    // which the read carrying on here has put in the cache meanwhile
    result = isDataRequest ? await read : await within(read);
  } catch (err) {
    if (err instanceof AniListRateLimitError) {
      locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
      error(429, { message: err.message, retryAt: Date.now() + err.retryAfter * 1000 });
    }
    if (err instanceof AniListNotFoundError) {
      error(404, `There's no AniList user named ${params.username}`);
    }
    throw err;
  }
  if (result === STILL_READING) stillReading('AniList', 'The friends list');

  return {
    domain: params.domain,
    user: result.user,
    friends: result.following,
    total: result.total,
    isOwnPage: locals.session?.user.id === result.user.id,
  };
}
