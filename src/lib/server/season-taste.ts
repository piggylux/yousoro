import { OTHER_LISTS, type ListedIds, type OtherList } from '#lib/types/api.js';
import type { SeasonTaste, TasteTrait, TraitKind } from '#lib/types/season.js';

/**
 * AniList's genres. Anything else MyAnimeList calls a genre, a theme or a demographic is one of
 * AniList's tags, when AniList has it
 */
const ANILIST_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
];
const GENRE_NAMES = new Map(ANILIST_GENRES.map((genre) => [genre.toLowerCase(), genre]));

/**
 * MyAnimeList's names for what AniList names otherwise. The rest share a name, as Isekai or
 * Shounen do, or AniList has nothing like them, and they're left to match nothing
 */
const MAL_NAMES: Record<string, string> = {
  suspense: 'Thriller',
  'girls love': 'Yuri',
  'boys love': "Boys' Love",
  gourmet: 'Food',
  cgdct: 'Cute Girls Doing Cute Things',
  'adult cast': 'Primarily Adult Cast',
  anthropomorphic: 'Anthropomorphism',
  medical: 'Medicine',
  'love polygon': 'Love Triangle',
  'magical sex shift': 'Gender Bending',
  'video game': 'Video Games',
};

/** Adult categories, which never make a reason to watch anything */
const MAL_ADULT = new Set(['hentai', 'erotica']);

/** A MyAnimeList genre, theme or demographic as AniList names it, or null for an adult one */
export function aniListTrait(malName: string): { kind: TraitKind; name: string } | null {
  const lower = malName.toLowerCase();
  if (MAL_ADULT.has(lower)) return null;
  const name = MAL_NAMES[lower] ?? malName;
  const genre = GENRE_NAMES.get(name.toLowerCase());
  return genre ? { kind: 'genre', name: genre } : { kind: 'tag', name };
}

/** A list entry as both services' reads give it: its anime's id, its list, progress and score */
export type TasteEntry = {
  id: number;
  /** As AniList names lists: CURRENT, REPEATING, COMPLETED, PAUSED, DROPPED or PLANNING */
  status: string;
  progress: number;
  /** Out of 100; 0 when unscored */
  score100: number;
};

/** Where each anime is and what it was scored, shaped as the season page reads them */
function listsOf(entries: TasteEntry[]) {
  const listed: Partial<Record<OtherList, number[]>> = {};
  const watching: SeasonTaste['watching'] = [];
  const scores: SeasonTaste['scores'] = [];
  let watched = 0;
  for (const { id, status, progress, score100 } of entries) {
    if (status === 'CURRENT' || status === 'REPEATING') {
      watching.push({ id, progress, rewatching: status === 'REPEATING' });
    } else if (OTHER_LISTS.includes(status as OtherList)) {
      (listed[status as OtherList] ??= []).push(id);
    }
    if (status === 'PLANNING') continue;
    watched++;
    if (score100 > 0) scores.push([id, score100]);
  }
  const mean100 = scores.length
    ? Math.round(scores.reduce((total, [, score]) => total + score, 0) / scores.length)
    : null;
  return { listedIds: listed as ListedIds, watching, scores, mean100, watched };
}

// Two decimals say all a lift needs to, and keep a long list's traits small
const rounded = (value: number) => Math.round(value * 100) / 100;

/**
 * How far above someone's average a trait's average is, in standard deviations of their scores;
 * null when nothing with it was scored, or their scores don't spread at all
 */
function liftOf(traitMean: number, mean: number, deviation: number): number | null {
  if (!(traitMean > 0) || !(mean > 0) || !(deviation > 0)) return null;
  return rounded((traitMean - mean) / deviation);
}

/** AniList's own statistics of someone's list, per genre, tag and studio, as the read gives them */
export type AniListStatistics = {
  count: number;
  /** In the user's own score format, as are the means below; 0 when they've scored nothing */
  meanScore: number;
  standardDeviation: number;
  genres: { genre: string | null; count: number; meanScore: number }[];
  tags: {
    tag: { name: string; isAdult: boolean | null } | null;
    count: number;
    meanScore: number;
  }[];
  studios: {
    studio: { name: string; isAnimationStudio: boolean | null } | null;
    count: number;
    meanScore: number;
  }[];
};

/**
 * Someone's taste from AniList's statistics of their list, which AniList keeps per genre, tag and
 * studio, so the read needn't bring every anime's tags. The statistics' means are compared with
 * their own overall mean and deviation, so their score format doesn't matter
 */
export function fromAniListStatistics(
  statistics: AniListStatistics,
  entries: TasteEntry[]
): SeasonTaste {
  const { meanScore, standardDeviation } = statistics;
  const trait = (kind: TraitKind, name: string, count: number, mean: number): TasteTrait => ({
    kind,
    name,
    count,
    lift: liftOf(mean, meanScore, standardDeviation),
  });
  const traits = [
    ...statistics.genres.flatMap(({ genre, count, meanScore: mean }) =>
      genre ? [trait('genre', genre, count, mean)] : []
    ),
    ...statistics.tags.flatMap(({ tag, count, meanScore: mean }) =>
      tag && !tag.isAdult ? [trait('tag', tag.name, count, mean)] : []
    ),
    // Producers and licensors are counted as studios too, but only animation studios make anime
    ...statistics.studios.flatMap(({ studio, count, meanScore: mean }) =>
      studio?.isAnimationStudio ? [trait('studio', studio.name, count, mean)] : []
    ),
  ];
  const { watched, ...lists } = listsOf(entries);
  return { ...lists, scored: lists.scores.length, watched, traits };
}

/** An entry of a MyAnimeList list, with what the season page reads of its anime */
export type MalTasteEntry = TasteEntry & { genres: string[]; studios: string[] };

/**
 * Someone's taste from their MyAnimeList list, which has no statistics to read: each genre, theme,
 * demographic and studio's average score is worked out from the list itself, against their own
 * average and deviation, as AniList's statistics are
 */
export function fromMalEntries(entries: MalTasteEntry[]): SeasonTaste {
  const scored = entries.filter(({ status, score100 }) => status !== 'PLANNING' && score100 > 0);
  const mean = scored.reduce((total, { score100 }) => total + score100, 0) / (scored.length || 1);
  const deviation = Math.sqrt(
    scored.reduce((total, { score100 }) => total + (score100 - mean) ** 2, 0) / (scored.length || 1)
  );
  const totals = new Map<
    string,
    { kind: TraitKind; name: string; count: number; sum: number; scored: number }
  >();
  for (const { status, score100, genres, studios } of entries) {
    if (status === 'PLANNING') continue;
    const traits = [
      ...genres.flatMap((genre) => aniListTrait(genre) ?? []),
      ...studios.map((name) => ({ kind: 'studio' as const, name })),
    ];
    for (const { kind, name } of traits) {
      const key = `${kind}:${name.toLowerCase()}`;
      const total = totals.get(key) ?? { kind, name, count: 0, sum: 0, scored: 0 };
      total.count++;
      if (score100 > 0) {
        total.sum += score100;
        total.scored++;
      }
      totals.set(key, total);
    }
  }
  const traits = [...totals.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ kind, name, count, sum, scored: traitScored }) => ({
      kind,
      name,
      count,
      lift: traitScored ? liftOf(sum / traitScored, mean, deviation) : null,
    }));
  const { watched, ...lists } = listsOf(entries);
  return { ...lists, scored: lists.scores.length, watched, traits };
}
