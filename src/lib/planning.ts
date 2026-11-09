import { searchWords } from '#lib/anime.js';
import type { PlannedAnime, PlannedSequel, Sequel } from '#lib/types/anime.js';
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
export function distinctEnglishTitle({
  title,
  englishTitle,
}: Pick<PlannedAnime, 'title' | 'englishTitle'>): string | null {
  const squashed = (text: string) => searchWords(text).join('');
  return englishTitle && squashed(englishTitle) !== squashed(title) ? englishTitle : null;
}

const episodes = (count: number) =>
  `${count.toLocaleString('en')} episode${count === 1 ? '' : 's'}`;

/** Where an anime is in its run, under its poster: "12 episodes", "Airing · 24 episodes" */
export function describePlanned(anime: Pick<PlannedAnime, 'status' | 'episodes'>): string {
  switch (anime.status) {
    case 'NOT_YET_RELEASED':
      return 'Not aired yet';
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

const FORMATS: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music video',
};

// When an announced anime starts, as precisely as AniList knows: "Starts April 4, 2027"
function startsOn({ year, month, day }: Sequel['startDate']): string {
  if (!year) return 'Date not announced';
  if (!month) return `Starts ${year}`;
  const date = new Date(Date.UTC(year, month - 1, day ?? 1));
  return `Starts ${date.toLocaleDateString('en', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    ...(day && { day: 'numeric' }),
  })}`;
}

/**
 * What a sequel is, when it aired and where it is in its run, under its title once an anime is
 * finished: "TV · 2024 · 12 episodes · On your plan list", or "TV · Starts April 2027" for one not
 * out yet. A film out already is simply a film
 */
export function sequelFacts(sequel: Sequel): string {
  const announced = sequel.status === 'NOT_YET_RELEASED';
  const film = sequel.format === 'MOVIE' && sequel.status === 'FINISHED';
  return [
    sequel.format && (FORMATS[sequel.format] ?? sequel.format),
    announced ? startsOn(sequel.startDate) : sequel.startDate.year,
    !announced && !film && describePlanned(sequel),
    sequel.planned && 'On your plan list',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A series on a plan list: the parts of it on the list, in the order to watch them. The first part
 * leads it, and it's sorted and filtered by that one, as it's the part to start
 */
export type PlannedSeries = Series<PlannedAnime>;

/** A series' parts, in the order to watch them */
export type Series<T> = { parts: [T, ...T[]] };

/**
 * The plan list as series, each where its first part is on the list. Parts are joined by the
 * prequels each waits on, so a series only holds the parts on this list; an anime that continues
 * nothing on it is a series of its own. Parts come after what they continue, and otherwise in
 * airing order, as a movie and a second season that both follow the first. Search results are
 * grouped the same way
 */
export function groupSeries<T extends Pick<PlannedAnime, 'id' | 'prequels' | 'year'>>(
  planned: T[]
): Series<T>[] {
  const position = new Map<number, number>();
  planned.forEach((anime, index) => {
    if (anime.id !== null) position.set(anime.id, index);
  });
  const prequelsOf = planned.map((anime) => anime.prequels.flatMap((id) => position.get(id) ?? []));

  // Each anime's series, by the position of one of its parts
  const series = planned.map((_, index) => index);
  const seriesOf = (index: number): number =>
    series[index] === index ? index : (series[index] = seriesOf(series[index]));
  prequelsOf.forEach((prequels, index) => {
    for (const prequel of prequels) series[seriesOf(index)] = seriesOf(prequel);
  });
  const members = new Map<number, number[]>();
  planned.forEach((_, index) => {
    const parts = members.get(seriesOf(index));
    if (parts) parts.push(index);
    else members.set(seriesOf(index), [index]);
  });

  const airsBefore = (a: number, b: number) =>
    (planned[a].year ?? Infinity) - (planned[b].year ?? Infinity) || a - b;
  const grouped = [...members.values()].map((indexes) => {
    if (indexes.length === 1) return indexes;
    // The next part is the earliest-airing one whose prequels on the list are all placed
    const placed = new Set<number>();
    const order: number[] = [];
    while (order.length < indexes.length) {
      const ready = indexes.filter(
        (index) => !placed.has(index) && prequelsOf[index].every((prequel) => placed.has(prequel))
      );
      // Prequels always aired earlier, so they can't loop; were they to, the rest go in airing order
      const next = (ready.length ? ready : indexes.filter((index) => !placed.has(index))).sort(
        airsBefore
      )[0];
      placed.add(next);
      order.push(next);
    }
    return order;
  });
  return grouped
    .sort((a, b) => a[0] - b[0])
    .map((order) => ({
      parts: order.map((index) => planned[index]) as Series<T>['parts'],
    }));
}

/** What comes after a series' first part: a later part on the list, or a sequel that isn't */
export type SeriesStep =
  | { kind: 'part'; anime: PlannedAnime }
  | { kind: 'sequel'; anime: PlannedSequel };

/**
 * What comes after a series' first part, in the order to watch it: its later parts, each followed
 * by the sequels of it the page doesn't list. A sequel of two parts goes after the later one
 */
export function seriesSteps({ parts }: PlannedSeries): SeriesStep[] {
  const follows = new Map<number, { after: number; sequel: PlannedSequel }>();
  parts.forEach((anime, after) => {
    for (const sequel of anime.sequels) {
      follows.delete(sequel.id);
      follows.set(sequel.id, { after, sequel });
    }
  });
  const sequelsAfter = parts.map(() => [] as SeriesStep[]);
  for (const { after, sequel } of follows.values()) {
    sequelsAfter[after].push({ kind: 'sequel', anime: sequel });
  }
  return parts.flatMap((anime, index): SeriesStep[] => [
    ...(index ? [{ kind: 'part' as const, anime }] : []),
    ...sequelsAfter[index],
  ]);
}

export const PLAN_SORTS = {
  planned: 'Recently planned',
  score: 'Top rated',
  length: 'Shortest first',
  title: 'Title A–Z',
} as const;
export type PlanSort = keyof typeof PLAN_SORTS;

// Unknown scores and lengths go after the known ones, whichever way those are sorted
const byKnown = (a: number | null, b: number | null, descending = false) =>
  a === null || b === null ? Number(a === null) - Number(b === null) : descending ? b - a : a - b;
const titles = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** The series in the chosen order; ties keep the order they were planned in */
export function sortSeries(series: PlannedSeries[], sort: PlanSort): PlannedSeries[] {
  if (sort === 'planned') return series;
  const compare = {
    score: (a: PlannedAnime, b: PlannedAnime) => byKnown(a.meanScore, b.meanScore, true),
    length: (a: PlannedAnime, b: PlannedAnime) => byKnown(a.episodes, b.episodes),
    title: (a: PlannedAnime, b: PlannedAnime) => titles.compare(a.title, b.title),
  }[sort];
  return series.toSorted((a, b) => compare(a.parts[0], b.parts[0]));
}

/** A single cour or less: what can be watched over a season, or a weekend */
export const SHORT_EPISODES = 13;

// Labelled by its length rather than "Short", which anime fans read as the format of minute-long episodes
export const PLAN_FILTERS = {
  airing: { label: 'Airing', matches: (anime: PlannedAnime) => anime.status === 'RELEASING' },
  short: {
    label: `≤ ${SHORT_EPISODES} episodes`,
    matches: (anime: PlannedAnime) => anime.episodes !== null && anime.episodes <= SHORT_EPISODES,
  },
};
export type PlanFilter = keyof typeof PLAN_FILTERS;

/** How many planned anime the series hold, as the header counts them: every part on the list */
export function countAnime(series: PlannedSeries[]): number {
  return series.reduce((total, { parts }) => total + parts.length, 0);
}

/**
 * The genres the series lead with, A to Z, with how many planned anime choosing each shows: a
 * series is filtered by its first part, and brings its later parts with it
 */
export function seriesGenres(series: PlannedSeries[]): { genre: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { parts } of series) {
    for (const genre of parts[0].genres) counts.set(genre, (counts.get(genre) ?? 0) + parts.length);
  }
  return [...counts]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => titles.compare(a.genre, b.genre));
}

/** One of the choices at random, other than the last one picked while there are others */
export function pickAnother<T>(choices: T[], last: T | null, random = Math.random): T | null {
  const others = choices.length > 1 ? choices.filter((choice) => choice !== last) : choices;
  return others.length ? others[Math.floor(random() * others.length)] : null;
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

/**
 * Takes an anime the user started watching off the plan lists the tab remembers, found by the id
 * the list's own service gives it, as a sequel started elsewhere may not have the other
 */
export function markStarted(
  domain: Domain,
  username: string,
  anime: Pick<PlannedAnime, 'id' | 'malId'>
) {
  const suffix = `:${listKey(domain, username)}`;
  const id = domain === 'anilist' ? 'id' : 'malId';
  for (const [key, saved] of remembered) {
    if (!key.endsWith(suffix)) continue;
    const planned = saved.data.planned.filter(
      (other) => anime[id] === null || other[id] !== anime[id]
    );
    remembered.set(key, { ...saved, data: { ...saved.data, planned } });
  }
}

/**
 * Forgets the plan lists the tab remembers for a list, as when the user added an anime to it from
 * elsewhere, so the plan page reads it again
 */
export function forgetPlanned(domain: Domain, username: string) {
  const suffix = `:${listKey(domain, username)}`;
  for (const key of remembered.keys()) if (key.endsWith(suffix)) remembered.delete(key);
}
