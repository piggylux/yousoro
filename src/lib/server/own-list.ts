import { fail, type RequestEvent } from '@sveltejs/kit';

import { AniListRateLimitError, AniListTokenError } from '#lib/server/anilist-client.js';
import { MalRateLimitError, MalTokenError } from '#lib/server/myanimelist-client.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import { DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

/**
 * Runs an update on the signed-in user's own list on the page's service, whatever list the page
 * shows, and turns what can go wrong into a message for the card
 */
export async function updateOwnList<T>(
  { locals, cookies }: Pick<RequestEvent, 'locals' | 'cookies'>,
  domain: Domain,
  update: () => Promise<T>
) {
  const service = DOMAIN_NAMES[domain];
  if (!(domain === 'anilist' ? locals.session : locals.malSession)) {
    return fail(401, { message: `Sign in with ${service} to update your list` });
  }
  try {
    return await update();
  } catch (err) {
    if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
      locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
      return fail(429, { message: err.message });
    }
    console.error(err);
    if (err instanceof AniListTokenError || err instanceof MalTokenError) {
      if (domain === 'anilist') clearSession(cookies);
      else clearMalSession(cookies);
      return fail(401, { message: `Your ${service} sign-in expired, please sign in again` });
    }
    return fail(502, { message: `${service} rejected the update, please try again` });
  }
}
