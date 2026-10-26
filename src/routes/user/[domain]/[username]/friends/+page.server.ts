import { error, type Cookies } from '@sveltejs/kit';

import {
  AniListNotFoundError,
  AniListTokenError,
  AniListRateLimitError,
  getFollowing,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearSession } from '#lib/server/session.js';
import { isDomain } from '#lib/types/domain.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({
  params,
  locals,
  cookies,
  getClientAddress,
}: {
  params: { username: string; domain: string };
  locals: App.Locals;
  cookies: Cookies;
  getClientAddress: () => string;
}) {
  if (!isDomain(params.domain)) {
    error(404, `Unknown domain: ${params.domain}`);
  }

  let result;
  try {
    const limit = await takeClientLimit(getClientAddress(), 'read', 5);
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    result = await getFollowing(params.username, locals.session?.token);
  } catch (err) {
    if (err instanceof AniListRateLimitError) {
      locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
      error(429, err.message);
    }
    if (err instanceof AniListNotFoundError) {
      error(404, `There's no AniList user named ${params.username}`);
    }
    if (!(err instanceof AniListTokenError) || !locals.session) throw err;
    // The signed-in user's token expired: sign them out and read the public list instead
    clearSession(cookies);
    locals.session = null;
    result = await getFollowing(params.username);
  }

  return {
    domain: params.domain,
    user: result.user,
    friends: result.following,
    total: result.total,
    isOwnPage: locals.session?.user.id === result.user.id,
  };
}
