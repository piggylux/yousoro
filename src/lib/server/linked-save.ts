import type { Cookies } from '@sveltejs/kit';

import { toMalScore } from '#lib/score.js';
import {
  AniListRateLimitError,
  AniListTokenError,
  saveEntry as saveAniListEntry,
} from '#lib/server/anilist-client.js';
import type { EntryUpdate } from '#lib/server/entry-update.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import {
  copyEntry,
  MalNotFoundError,
  MalRateLimitError,
  MalTokenError,
} from '#lib/server/myanimelist-client.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import type { LinkedFailure } from '#lib/types/api.js';
import { DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

/**
 * Copies a save on one service to the user's account on the other, when they're signed in to both:
 * the episode count, status and dates as the save left them, and the score when it changed. A date
 * the save left unset doesn't clear the other's. These are the
 * entry as it now is rather than a change to it, so a copy that failed is made up by the next one.
 * The save itself has already succeeded, so this never throws: a failure only comes back as a
 * message for the user
 */
export async function copyToLinkedAccount(
  event: { cookies: Cookies; locals: App.Locals },
  from: Domain,
  { mediaId, malId, changes, scoreFormat }: EntryUpdate,
  saved: {
    progress: number;
    score: number;
    status: string;
    startedAt?: string | null;
    completedAt?: string | null;
  }
): Promise<LinkedFailure | null> {
  const to: Domain = from === 'anilist' ? 'myanimelist' : 'anilist';
  const aniListSession = event.locals.session;
  if (!(to === 'anilist' ? aniListSession : event.locals.malSession)) return null;
  const service = DOMAIN_NAMES[to];
  const failed = (reason: string, retry = true) => ({
    message: `Saved on ${DOMAIN_NAMES[from]}, but ${reason}`,
    retry,
  });

  try {
    if (to === 'myanimelist') {
      if (malId === undefined) return failed("this anime isn't on MyAnimeList.", false);
      const score =
        changes.score !== undefined && scoreFormat
          ? toMalScore(saved.score, scoreFormat)
          : undefined;
      await withMalToken(event, (token) =>
        copyEntry(token, malId, {
          progress: saved.progress,
          status: saved.status,
          score,
          startedAt: saved.startedAt,
          completedAt: saved.completedAt,
        })
      );
    } else {
      await saveAniListEntry(aniListSession!.token, mediaId, {
        progress: saved.progress,
        status: saved.status,
        startedAt: saved.startedAt,
        completedAt: saved.completedAt,
        // A MyAnimeList score out of 10 is exact out of 100, in whatever format AniList shows it
        ...(changes.score !== undefined && { scoreRaw: saved.score * 10 }),
      });
    }
    return null;
  } catch (err) {
    if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
      return failed(`${service} is busy right now.`);
    }
    if (err instanceof MalNotFoundError) return failed("this anime isn't on MyAnimeList.", false);
    if (err instanceof AniListTokenError || err instanceof MalTokenError) {
      if (to === 'anilist') {
        clearSession(event.cookies);
        event.locals.session = null;
      } else {
        clearMalSession(event.cookies);
        event.locals.malSession = null;
      }
      return failed(`your ${service} sign-in expired. Link it again in settings.`, false);
    }
    console.error(`Could not copy a save to ${service}`, err);
    return failed(`${service} didn't take the update.`);
  }
}
