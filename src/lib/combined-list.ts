import type { Anime } from '#lib/types/anime.js';
import type { PlannedList } from '#lib/types/api.js';
import type { Domain } from '#lib/types/domain.js';

export const otherDomain = (domain: Domain): Domain =>
  domain === 'anilist' ? 'myanimelist' : 'anilist';

const later = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

/**
 * One Watching list from the owner's lists on both services, matched by AniList id. An anime on
 * both shows as far along as either list has it, as the owner most likely watched that far, and
 * with the main list's score, in its format: converting the other's would round it. An anime on one
 * list only is marked with that list's service, and keeps its own score, in that service's format
 */
export function combineWatchingLists(main: Anime[], other: Anime[], mainDomain: Domain): Anime[] {
  const others = new Map(other.map((anime) => [anime.id, anime]));
  const combined = main.map((anime): Anime => {
    const twin = others.get(anime.id);
    if (!twin) return { ...anime, onlyOn: mainDomain };
    others.delete(anime.id);
    const ahead = twin.currentEpisode > anime.currentEpisode ? twin : anime;
    return {
      ...anime,
      currentEpisode: ahead.currentEpisode,
      rewatching: ahead.rewatching,
      lastUpdatedAt: later(anime.lastUpdatedAt, twin.lastUpdatedAt),
    };
  });
  const onlyOther = otherDomain(mainDomain);
  return [...combined, ...[...others.values()].map((anime) => ({ ...anime, onlyOn: onlyOther }))];
}

type Planned = PlannedList['planned'][number];

/**
 * One plan list from the owner's lists on both services, matched by MyAnimeList id. AniList's entry
 * is kept for an anime on both, as it alone knows the anime's AniList id and what it continues,
 * planned as late as either list says. Anime on one list only are marked with that list's service;
 * those only on MyAnimeList stay without an AniList id, as looking them up would cost a request
 * per 50
 */
export function combinePlannedLists(aniList: Planned[], mal: Planned[]): Planned[] {
  const fromMal = new Map(mal.map((anime) => [anime.malId, anime]));
  const combined = aniList.map((anime): Planned => {
    const twin = anime.malId === null ? undefined : fromMal.get(anime.malId);
    if (!twin) return { ...anime, onlyOn: 'anilist' };
    fromMal.delete(anime.malId);
    return { ...anime, addedAt: later(anime.addedAt, twin.addedAt) };
  });
  return [
    ...combined,
    ...[...fromMal.values()].map((anime): Planned => ({ ...anime, onlyOn: 'myanimelist' })),
  ];
}
