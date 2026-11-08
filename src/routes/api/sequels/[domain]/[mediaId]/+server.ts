import { error, json } from '@sveltejs/kit';

import { AniListRateLimitError, AniListTokenError } from '#lib/server/anilist-client.js';
import { MalRateLimitError, MalTokenError } from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { findSequels } from '#lib/server/sequels.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import { DOMAIN_NAMES, isDomain } from '#lib/types/domain.js';

import type { RequestHandler } from './$types';

/**
 * The sequels to offer the signed-in user once they finish an anime on their own list on that
 * service, by the anime's AniList id: `{ sequels }`, empty when there's nothing to start
 */
export const GET: RequestHandler = async (event) => {
  const { domain } = event.params;
  if (!isDomain(domain)) error(404, 'Unknown list');
  const mediaId = Number(event.params.mediaId);
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || mediaId > 2147483647) {
    error(400, 'Unknown anime');
  }
  const service = DOMAIN_NAMES[domain];
  if (!(domain === 'anilist' ? event.locals.session : event.locals.malSession)) {
    error(401, `Sign in with ${service} to see what comes next`);
  }
  const limit = await takeClientLimit(event.getClientAddress(), 'read');
  if (!limit.allowed) {
    event.locals.retryAfter = limit.retryAfter;
    error(429, 'Too many requests, please try again shortly');
  }
  try {
    return json({ sequels: await findSequels(event, domain, mediaId) });
  } catch (err) {
    if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
      event.locals.retryAfter = err.retryAfter;
      error(429, err.message);
    }
    if (err instanceof AniListTokenError || err instanceof MalTokenError) {
      if (domain === 'anilist') {
        clearSession(event.cookies);
        event.locals.session = null;
      } else {
        clearMalSession(event.cookies);
        event.locals.malSession = null;
      }
      error(401, `Your ${service} sign-in expired, please sign in again`);
    }
    console.error('Could not look up sequels', err);
    error(502, `${service} didn't say what comes next, please try again`);
  }
};
