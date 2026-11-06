import { animeKey, parsePersonSegment, personSegment, sameName, titleOrder } from '#lib/match.js';
import { listPath, type ListOwner } from '#lib/types/domain.js';
import type { ListedAnime, TasteProfile } from '#lib/types/match.js';

/** Everyone in a group, its host included: enough for a watch party, few enough to read quickly */
export const MAX_GROUP = 6;
// Picks fill two rows of posters on a wide screen
const SHOWN_PICKS = 12;

/** An anime nobody in a group has seen, and who in it plans to watch it */
export type GroupPick = {
  anime: ListedAnime;
  /** Who has it on their plan list, in the group's order */
  plannedBy: ListOwner[];
};

/**
 * What a group could start together: anime on someone's plan list that nobody in it has watched
 * any of, whether they finished, dropped or are watching it. Those most of the group plan to watch
 * come first, then the best rated. Adult anime are left out unless `showMature`
 */
export function pickForGroup(
  profiles: TasteProfile[],
  { showMature = false }: { showMature?: boolean } = {}
): GroupPick[] {
  const key = animeKey(profiles);
  const seen = new Set(
    profiles.flatMap((profile) => [...profile.seen, ...profile.scored].map(key))
  );
  const picks = new Map<string, GroupPick>();
  for (const profile of profiles) {
    for (const anime of profile.planned) {
      if (seen.has(key(anime)) || (anime.isAdult && !showMature)) continue;
      const pick = picks.get(key(anime)) ?? { anime, plannedBy: [] };
      pick.plannedBy.push({ domain: profile.domain, name: profile.name });
      picks.set(key(anime), pick);
    }
  }
  const byTitle = titleOrder(key);
  return [...picks.values()]
    .sort(
      (x, y) =>
        y.plannedBy.length - x.plannedBy.length ||
        (y.anime.meanScore ?? 0) - (x.anime.meanScore ?? 0) ||
        byTitle(x.anime, y.anime)
    )
    .slice(0, SHOWN_PICKS);
}

/**
 * The people in a group's path after its host, in order, without repeats or names that can't be
 * anyone's, up to the group's size with its host. Case is ignored, as both services ignore it
 */
export function groupMembers(host: ListOwner, others: string): ListOwner[] {
  const members = [host];
  for (const segment of others.split('/')) {
    if (members.length >= MAX_GROUP) break;
    const member = parsePersonSegment(segment, host.domain);
    if (member && !members.some((kept) => sameName(kept, member))) members.push(member);
  }
  return members.slice(1);
}

/** Where a group led by `host` picks something to watch together */
export function togetherPath(host: ListOwner, others: ListOwner[] = []) {
  return [
    `${listPath(host.domain, host.name)}/together`,
    ...others.map((other) => personSegment(other, host.domain)),
  ].join('/');
}
