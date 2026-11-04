import { searchWords } from '#lib/anime.js';
import type { PlannedAnime } from '#lib/types/anime.js';
import type { PlanningPageData } from '#lib/types/api.js';
import type { Domain } from '#lib/types/domain.js';

/** One anime's key on a plan list: AniList's id on AniList lists, MyAnimeList's on its own */
export function plannedKey(anime: PlannedAnime): string {
  return `${anime.id}:${anime.malId}`;
}

/**
 * The English title, when it says more than the title: not when it only differs in case, spaces or
 * punctuation, as "Girls Band Cry" from "GIRLS BAND CRY"
 */
export function distinctEnglishTitle({ title, englishTitle }: PlannedAnime): string | null {
  const squashed = (text: string) => searchWords(text).join('');
  return englishTitle && squashed(englishTitle) !== squashed(title) ? englishTitle : null;
}

const episodes = (count: number) =>
  `${count.toLocaleString('en')} episode${count === 1 ? '' : 's'}`;

/** Where an anime is in its run, under its poster: "12 episodes", "Airing · 24 episodes" */
export function describePlanned(anime: PlannedAnime): string {
  switch (anime.status) {
    case 'RELEASING':
      return anime.episodes ? `Airing · ${episodes(anime.episodes)}` : 'Airing';
    case 'HIATUS':
      return 'On hiatus';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return anime.episodes ? episodes(anime.episodes) : 'Finished';
  }
}

/*
 * Plan lists the tab has shown, kept for a few minutes so coming back to one, as from the watching
 * list, doesn't ask AniList or MyAnimeList for the whole list again. Kept per viewer and mature
 * setting, as both change what the list holds. Used in the browser only
 */
const remembered = new Map<string, { data: PlanningPageData; expiresAt: number }>();
const REMEMBER_MS = 5 * 60 * 1000;
const MAX_REMEMBERED = 10;
const listKey = (domain: string, username: string) => `${domain}:${username.toLowerCase()}`;
const rememberKey = (
  viewer: string | null,
  showMature: boolean,
  domain: string,
  username: string
) => `${viewer}:${showMature}:${listKey(domain, username)}`;

export function getRememberedPlanned(
  viewer: string | null,
  showMature: boolean,
  domain: string,
  username: string
): PlanningPageData | null {
  const key = rememberKey(viewer, showMature, domain, username);
  const saved = remembered.get(key);
  if (saved && saved.expiresAt > Date.now()) return saved.data;
  remembered.delete(key);
  return null;
}

export function rememberPlanned(
  viewer: string | null,
  showMature: boolean,
  username: string,
  data: PlanningPageData
) {
  const key = rememberKey(viewer, showMature, data.domain, username);
  remembered.delete(key);
  if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!);
  remembered.set(key, { data, expiresAt: Date.now() + REMEMBER_MS });
}

/** Takes an anime the user started watching off the plan lists the tab remembers */
export function markStarted(domain: Domain, username: string, anime: PlannedAnime) {
  const suffix = `:${listKey(domain, username)}`;
  const started = plannedKey(anime);
  for (const [key, saved] of remembered) {
    if (!key.endsWith(suffix)) continue;
    const planned = saved.data.planned.filter((other) => plannedKey(other) !== started);
    remembered.set(key, { ...saved, data: { ...saved.data, planned } });
  }
}
