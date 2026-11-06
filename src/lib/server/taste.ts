import {
  AniListNotFoundError,
  AniListRateLimitError,
  getTasteProfile as getAniListTasteProfile,
} from '#lib/server/anilist-client.js';
import { MAL_ENABLED } from '#lib/server/myanimelist-auth.js';
import {
  getTasteProfile as getMalTasteProfile,
  MalForbiddenError,
  MalNotFoundError,
  MalRateLimitError,
} from '#lib/server/myanimelist-client.js';
import { DOMAIN_NAMES, type ListOwner } from '#lib/types/domain.js';
import type { TasteProfile } from '#lib/types/match.js';

/** Thrown when someone's list can't be read: there's nobody by the name, or their list is private */
export class TasteProfileMissingError extends Error {}

/** Thrown when someone's list's service is busy for `retryAfter` seconds */
export class TasteProfileBusyError extends Error {
  constructor(
    public domain: ListOwner['domain'],
    public retryAfter: number
  ) {
    super(`${DOMAIN_NAMES[domain]} is busy, please try again shortly`);
  }
}

/**
 * Someone's taste profile from their list's service, read anonymously, with either service's
 * missing or private lists and busy answers as the errors above. A MyAnimeList profile keeps the
 * name as asked for, as MyAnimeList doesn't say how its owner spells it
 */
export async function readTasteProfile(person: ListOwner): Promise<TasteProfile> {
  try {
    if (person.domain === 'anilist') return await getAniListTasteProfile(person.name);
    if (!MAL_ENABLED) throw new TasteProfileMissingError('MyAnimeList is not set up');
    return { ...(await getMalTasteProfile(person.name)), name: person.name };
  } catch (err) {
    if (
      err instanceof AniListNotFoundError ||
      err instanceof MalNotFoundError ||
      err instanceof MalForbiddenError
    ) {
      throw new TasteProfileMissingError(err.message);
    }
    if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
      throw new TasteProfileBusyError(person.domain, err.retryAfter);
    }
    throw err;
  }
}
