import { isUserName } from '#lib/match.js';
import type { ScoreFormat } from '#lib/score.js';
import type { ListedAnime, ScoredAnime, TasteProfile } from '#lib/types/match.js';

/** Everyone in a group, its host included: enough for a watch party, few enough to read quickly */
export const MAX_GROUP = 6;
// Picks fill two rows of posters on a wide screen
const SHOWN_PICKS = 12;

/** An anime for a group to watch together, and who in it vouches for it or wants to see it */
export type GroupPick = {
  anime: ListedAnime;
  /** Who scored it above their own average, with their score in their own format */
  lovedBy: { name: string; score: number; scoreFormat: ScoreFormat }[];
  /** Who has it on their plan list */
  plannedBy: string[];
  /** How many in the group haven't seen it */
  newTo: number;
};

/**
 * What a group could watch together: anime someone in it loved or several plan to watch, that
 * nobody has seen without loving it, and that's new to someone. The ones most of them want come
 * first, then those the people who loved them loved most, then AniList's favorites. Adult anime
 * are left out unless `showMature`
 */
export function pickForGroup(
  profiles: TasteProfile[],
  { showMature = false }: { showMature?: boolean } = {}
): GroupPick[] {
  const candidates = new Map<number, GroupPick>();
  const candidate = ({ id, title, coverUrl, isAdult, meanScore }: ListedAnime) => {
    let entry = candidates.get(id);
    if (!entry) {
      entry = {
        anime: { id, title, coverUrl, isAdult, meanScore },
        lovedBy: [],
        plannedBy: [],
        newTo: 0,
      };
      candidates.set(id, entry);
    }
    return entry;
  };
  // How far above their own averages those who loved an anime scored it, all together
  const fondness = new Map<number, number>();
  // Seen by someone who didn't love it, or is watching it now: not one to start together
  const ruledOut = new Set<number>();

  for (const profile of profiles) {
    const average = averageScore(profile.scored);
    for (const anime of profile.scored) {
      if (anime.score100 <= average) {
        ruledOut.add(anime.id);
        continue;
      }
      candidate(anime).lovedBy.push({
        name: profile.name,
        score: anime.score,
        scoreFormat: profile.scoreFormat,
      });
      fondness.set(anime.id, (fondness.get(anime.id) ?? 0) + anime.score100 - average);
    }
    for (const id of profile.seen) ruledOut.add(id);
    for (const anime of profile.planned) candidate(anime).plannedBy.push(profile.name);
  }

  return [...candidates.values()]
    .filter(
      (entry) =>
        !ruledOut.has(entry.anime.id) &&
        (showMature || !entry.anime.isAdult) &&
        // One person's plan list alone says nothing about the group
        (entry.lovedBy.length > 0 || entry.plannedBy.length > 1) &&
        entry.lovedBy.length < profiles.length
    )
    .map((entry) => ({ ...entry, newTo: profiles.length - entry.lovedBy.length }))
    .sort(
      (x, y) =>
        y.lovedBy.length + y.plannedBy.length - (x.lovedBy.length + x.plannedBy.length) ||
        y.lovedBy.length - x.lovedBy.length ||
        (fondness.get(y.anime.id) ?? 0) - (fondness.get(x.anime.id) ?? 0) ||
        (y.anime.meanScore ?? 0) - (x.anime.meanScore ?? 0) ||
        x.anime.title.localeCompare(y.anime.title) ||
        x.anime.id - y.anime.id
    )
    .slice(0, SHOWN_PICKS);
}

function averageScore(scored: ScoredAnime[]) {
  return scored.length ? scored.reduce((sum, anime) => sum + anime.score100, 0) / scored.length : 0;
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
