import type { Cookies } from '@sveltejs/kit';

import { getSequels, SERIES_FORMATS, type AniListSequel } from '#lib/server/anilist-client.js';
import { startedOn } from '#lib/server/anilist.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { getListStatuses } from '#lib/server/myanimelist-client.js';
import type { AiringStatus, Sequel } from '#lib/types/anime.js';
import type { Domain } from '#lib/types/domain.js';

/** The most sequels offered at once; an anime rarely has more than two */
export const MAX_SEQUELS = 3;
// Ones on hiatus have aired episodes to start with
const OUT: AiringStatus[] = ['FINISHED', 'RELEASING', 'HIATUS'];
// When it starts or started, as one number to compare; an unknown date goes last
const startsOn = ({ startDate }: AniListSequel) => startedOn(startDate) ?? Infinity;

/**
 * The sequels that could be offered on the list's service: the ones out first, to start, then the
 * ones announced, to plan. Each the next part of the series first, then in airing order. A
 * MyAnimeList list can only take one MyAnimeList knows
 */
function offerable(sequels: AniListSequel[], domain: Domain): AniListSequel[] {
  const announced = ({ status }: AniListSequel) => (status === 'NOT_YET_RELEASED' ? 1 : 0);
  // Series parts come before films and specials, which AniList also links as sequels
  const later = ({ format }: AniListSequel) => (SERIES_FORMATS.includes(format ?? '') ? 0 : 1);
  return sequels
    .filter(
      ({ status, malId }) =>
        (OUT.includes(status) || status === 'NOT_YET_RELEASED') &&
        (domain === 'anilist' || malId !== null)
    )
    .sort(
      (a, b) => announced(a) - announced(b) || later(a) - later(b) || startsOn(a) - startsOn(b)
    );
}

/**
 * The sequels to offer once an anime is finished: one out already to start, when it's either not on
 * the user's list or only planned, and one announced to plan, when it's not on their list at all.
 * One they're watching, paused, dropped or have seen already is theirs to go back to. Adult ones
 * are offered too, whatever the viewer's setting, as they just finished what it continues
 */
export function nextSequels(sequels: AniListSequel[], domain: Domain): Sequel[] {
  return offerable(sequels, domain)
    .filter(
      ({ status, listStatus }) =>
        listStatus === null || (listStatus === 'PLANNING' && status !== 'NOT_YET_RELEASED')
    )
    .slice(0, MAX_SEQUELS)
    .map(({ listStatus, ...sequel }) => ({ ...sequel, planned: listStatus === 'PLANNING' }));
}

/**
 * What to offer the signed-in user once they finish an anime on their list on `domain`. AniList
 * links the sequels for either service, and says where they are on an AniList list; a MyAnimeList
 * list is asked about the few that could be offered
 */
export async function findSequels(
  event: { cookies: Cookies; locals: App.Locals },
  domain: Domain,
  mediaId: number
): Promise<Sequel[]> {
  if (domain === 'anilist') {
    return nextSequels(await getSequels(mediaId, event.locals.session!.token), domain);
  }
  const candidates = offerable(await getSequels(mediaId), domain).slice(0, MAX_SEQUELS + 2);
  if (!candidates.length) return [];
  const statuses = await withMalToken(event, (token) =>
    getListStatuses(
      token,
      candidates.map(({ malId }) => malId!)
    )
  );
  return nextSequels(
    candidates.flatMap((sequel) =>
      statuses.has(sequel.malId!) ? [{ ...sequel, listStatus: statuses.get(sequel.malId!)! }] : []
    ),
    domain
  );
}
