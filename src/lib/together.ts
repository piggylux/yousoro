import { isUserName } from '#lib/match.js';
import type { ListedAnime, TasteProfile } from '#lib/types/match.js';

/** Everyone in a group, its host included: enough for a watch party, few enough to read quickly */
export const MAX_GROUP = 6;
// Picks fill two rows of posters on a wide screen
const SHOWN_PICKS = 12;

/** An anime nobody in a group has seen, and who in it plans to watch it */
export type GroupPick = {
  anime: ListedAnime;
  /** Who has it on their plan list, in the group's order */
  plannedBy: string[];
};

/**
 * What a group could start together: anime on someone's plan list that nobody in it has watched
 * any of, whether they finished, dropped or are watching it. Those most of the group plan to watch
 * come first, then AniList's favorites. Adult anime are left out unless `showMature`
 */
export function pickForGroup(
  profiles: TasteProfile[],
  { showMature = false }: { showMature?: boolean } = {}
): GroupPick[] {
  const seen = new Set(
    profiles.flatMap((profile) => [...profile.seen, ...profile.scored.map((anime) => anime.id)])
  );
  const picks = new Map<number, GroupPick>();
  for (const profile of profiles) {
    for (const anime of profile.planned) {
      if (seen.has(anime.id) || (anime.isAdult && !showMature)) continue;
      const pick = picks.get(anime.id) ?? { anime, plannedBy: [] };
      pick.plannedBy.push(profile.name);
      picks.set(anime.id, pick);
    }
  }
  return [...picks.values()]
    .sort(
      (x, y) =>
        y.plannedBy.length - x.plannedBy.length ||
        (y.anime.meanScore ?? 0) - (x.anime.meanScore ?? 0) ||
        x.anime.title.localeCompare(y.anime.title) ||
        x.anime.id - y.anime.id
    )
    .slice(0, SHOWN_PICKS);
}

/**
 * The names in a group's path, in order, without repeats or names that can't be AniList's, up to
 * the group's size with its host. Case is ignored, as AniList ignores it
 */
export function groupNames(host: string, others: string): string[] {
  const names = [host];
  for (const name of others.split('/')) {
    if (names.length >= MAX_GROUP) break;
    if (isUserName(name) && !names.some((kept) => kept.toLowerCase() === name.toLowerCase())) {
      names.push(name);
    }
  }
  return names.slice(1);
}

/** Where a group led by `host` picks something to watch together */
export function togetherPath(host: string, others: string[] = []) {
  return [
    `/user/anilist/${encodeURIComponent(host)}/together`,
    ...others.map(encodeURIComponent),
  ].join('/');
}
