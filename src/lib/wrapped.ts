import { retryAfterSeconds } from '#lib/read-retry.js';
import type { AnimeYear, FinishedAnime } from '#lib/types/wrapped.js';

/** Before this, AniList had no finish dates to read */
export const FIRST_YEAR = 2000;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** Anime seasons, each three months from January's Winter */
const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'] as const;
/** How far, out of 100, a score is from AniList's average for it to be a hot take */
const HOT_TAKE = 20;

/** The year to sum up: the one ending until January is over, then the one under way */
export function wrappedYear(now: Date): number {
  return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
}

// The furthest any time zone is ahead of UTC
const LATEST_ZONE_MS = 14 * 60 * 60 * 1000;

/**
 * The year in a path, when AniList could have finish dates in it: from FIRST_YEAR to the year it
 * is anywhere, so the browser and the server agree on it whatever their time zones
 */
export function parseWrappedYear(text: string, now = new Date()): number | null {
  const year = Number(text);
  const latest = new Date(now.getTime() + LATEST_ZONE_MS).getUTCFullYear();
  return /^\d{4}$/.test(text) && year >= FIRST_YEAR && year <= latest ? year : null;
}

/** Where `name`'s year in anime is summed up, the default year when `year` is left out */
export function wrappedPath(name: string, year?: number): string {
  const path = `/user/anilist/${encodeURIComponent(name)}/wrapped`;
  return year === undefined ? path : `${path}/${year}`;
}

/** A score someone gave far from AniList's average, either way */
export type HotTake = { anime: FinishedAnime; meanScore: number; higher: boolean };

/** Someone's year in anime, summed up */
export type YearSummary = {
  finished: number;
  episodes: number;
  hours: number;
  /** The genres of most anime they finished, the most first, three at most */
  topGenres: { genre: string; count: number }[];
  /** What they scored highest, AniList's favorite first among equals; null with nothing scored */
  favorite: FinishedAnime | null;
  /** Their favorites, for covers, adult anime left out unless `showMature` */
  favorites: FinishedAnime[];
  /** The score furthest from AniList's average, when one is far enough to say so */
  hotTake: HotTake | null;
  /** The month they finished most anime in, and how many; null when no month is known */
  busiestMonth: { month: string; count: number } | null;
  /** The anime with the most episodes they finished */
  longest: FinishedAnime | null;
  /** Each season's favorite, from what they finished in its months */
  seasons: { season: (typeof SEASONS)[number]; count: number; favorite: FinishedAnime | null }[];
};

/**
 * Sums up someone's year: how much they finished and how long it took, what they liked most, and
 * their hottest take. Counts include every anime; those shown leave out adult ones unless
 * `showMature`
 */
export function summarizeYear(
  year: AnimeYear,
  { showMature = false }: { showMature?: boolean } = {}
): YearSummary {
  const { finished } = year;
  const shown = finished.filter((anime) => showMature || !anime.isAdult);
  const favorites = shown.filter((anime) => anime.score100 !== null).toSorted(byFavorite);

  const genres = new Map<string, number>();
  for (const anime of finished) {
    for (const genre of anime.genres) genres.set(genre, (genres.get(genre) ?? 0) + 1);
  }

  const months = new Map<number, number>();
  for (const { month } of finished) if (month) months.set(month, (months.get(month) ?? 0) + 1);
  const [busiest] = [...months].toSorted(([a, x], [b, y]) => y - x || a - b);

  const [hottest] = shown
    .flatMap(({ score100, meanScore, ...anime }) =>
      score100 !== null && meanScore !== null
        ? [{ anime: { ...anime, score100, meanScore }, gap: score100 - meanScore }]
        : []
    )
    .filter(({ gap }) => Math.abs(gap) >= HOT_TAKE)
    .toSorted((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || byFavorite(a.anime, b.anime));

  return {
    finished: finished.length,
    episodes: sum(finished.map((anime) => anime.episodes)),
    hours: Math.round(sum(finished.map((anime) => anime.minutes)) / 60),
    topGenres: [...genres]
      .toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, 3)
      .map(([genre, count]) => ({ genre, count })),
    favorite: favorites[0] ?? null,
    favorites,
    hotTake: hottest
      ? { anime: hottest.anime, meanScore: hottest.anime.meanScore, higher: hottest.gap > 0 }
      : null,
    busiestMonth: busiest ? { month: MONTHS[busiest[0] - 1], count: busiest[1] } : null,
    longest: shown.toSorted((a, b) => b.episodes - a.episodes || byFavorite(a, b))[0] ?? null,
    seasons: SEASONS.map((season, index) => {
      const inSeason = shown.filter(
        ({ month }) => month !== null && Math.floor((month - 1) / 3) === index
      );
      return {
        season,
        count: inSeason.length,
        favorite: inSeason.toSorted(byFavorite)[0] ?? null,
      };
    }),
  };
}

/** Scored highest first, then AniList's favorite, then by title */
function byFavorite(x: FinishedAnime, y: FinishedAnime) {
  return (
    (y.score100 ?? -1) - (x.score100 ?? -1) ||
    (y.meanScore ?? 0) - (x.meanScore ?? 0) ||
    x.title.localeCompare(y.title)
  );
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export type AnimeYearState =
  | { status: 'loading' }
  | { status: 'ready'; year: AnimeYear }
  /** No such user, or their list is private */
  | { status: 'missing' }
  /** AniList is busy until `retryAt`, as Unix time in ms */
  | { status: 'busy'; retryAt: number }
  | { status: 'failed' };

/**
 * Reads someone's year in anime in the browser, from /api/wrapped, which the CDN keeps. Names are
 * sent in lower case, as AniList ignores case, so every spelling shares one cached year
 */
export async function loadAnimeYear(
  name: string,
  year: number,
  fetcher: typeof fetch = fetch
): Promise<Exclude<AnimeYearState, { status: 'loading' }>> {
  try {
    const response = await fetcher(
      `/api/wrapped/${encodeURIComponent(name.toLowerCase())}/${year}`
    );
    if (response.ok) return { status: 'ready', year: await response.json() };
    if (response.status === 404) return { status: 'missing' };
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response.headers.get('Retry-After'));
      return { status: 'busy', retryAt: Date.now() + seconds * 1000 };
    }
  } catch {
    // Offline, or the response wasn't readable: the same as AniList not answering
  }
  return { status: 'failed' };
}
