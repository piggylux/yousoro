import { error, type Cookies } from '@sveltejs/kit';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  getFollowing,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDomain } from '#lib/types/domain.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({
  params,
  locals,
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
    const limit = await takeClientLimit(getClientAddress(), 'read');
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    // Following is public. Anonymous reads can reuse the five-minute public cache,
    // including while signed in; private lists and matches still use the viewer's token.
    result = await getFollowing(params.username);
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

  return {
    domain: params.domain,
    user: result.user,
    friends: result.following,
    total: result.total,
    isOwnPage: locals.session?.user.id === result.user.id,
  };
}
