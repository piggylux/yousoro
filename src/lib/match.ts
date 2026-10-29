import { retryAfterSeconds } from '#lib/read-retry.js';
import type {
  MatchPick,
  ScoredAnime,
  ScoredByBoth,
  TasteMatch,
  TasteProfile,
} from '#lib/types/match.js';

/** Fewer anime scored by both say too little about how alike two tastes are */
export const MIN_BOTH_SCORED = 5;
/*
 * How a correlation of two people's scores reads as a percent. Anime fans' scores correlate far
 * less than the -1 to 1 it can span: across 150 pairs of AniList users, half fell between 0.08 and
 * 0.41, and none above 0.67. So the typical 0.25 reads as 50%, and each 0.01 either side as 1.25
 * points, filling the scale from -0.15 to 0.65 and every label of describeMatch with it
 */
const TYPICAL = 0.25;
const SPREAD = 125;
/**
 * A match drawn from few anime is pulled toward the typical one: half way with ten anime scored by
 * both, a tenth of the way with 90
 */
const CONFIDENCE = 10;
/** How far apart two scores of an anime are, out of 100, to count as a disagreement */
const DISAGREEMENT = 30;
// Picks fill one row of posters on a wide screen, and three of two on a phone
const SHOWN = { bothLoved: 8, disagreements: 4, picks: 6 };

/**
 * How two people's anime tastes compare, from their scores. The percent counts every anime, so it
 * is the same for every viewer; the anime shown leave out adult ones unless `showMature`
 */
export function compareTastes(
  a: TasteProfile,
  b: TasteProfile,
  { showMature = false }: { showMature?: boolean } = {}
): TasteMatch {
  const shown = (anime: ScoredAnime) => showMature || !anime.isAdult;
  const scoredByB = new Map(b.scored.map((anime) => [anime.id, anime]));
  const both = a.scored.flatMap((anime) => {
    const theirs = scoredByB.get(anime.id);
    return theirs ? [{ mine: anime, theirs }] : [];
  });

  const seenByA = new Set([...a.seen, ...a.scored.map((anime) => anime.id)]);
  const seenByB = new Set([...b.seen, ...b.scored.map((anime) => anime.id)]);
  const inCommon = [...seenByA].filter((id) => seenByB.has(id)).length;

  const averageA = average(a.scored.map((anime) => anime.score100));
  const averageB = average(b.scored.map((anime) => anime.score100));
  const pair = ({ mine, theirs }: (typeof both)[number]): ScoredByBoth => ({
    anime: mine,
    a: mine.score,
    b: theirs.score,
  });

  const gap = ({ mine, theirs }: (typeof both)[number]) =>
    Math.abs(mine.score100 - theirs.score100);
  // How far above their own averages both scored it
  const fondness = ({ mine, theirs }: (typeof both)[number]) =>
    mine.score100 - averageA + theirs.score100 - averageB;
  // Scored 30 points apart, an anime is a disagreement, even when both liked it more than most
  const bothLoved = both
    .filter(({ mine, theirs }) => mine.score100 > averageA && theirs.score100 > averageB)
    .filter((entry) => gap(entry) < DISAGREEMENT && shown(entry.mine))
    .sort((x, y) => fondness(y) - fondness(x) || byTitle(x.mine, y.mine))
    .slice(0, SHOWN.bothLoved)
    .map(pair);

  const disagreements = both
    .filter((entry) => gap(entry) >= DISAGREEMENT && shown(entry.mine))
    .sort((x, y) => gap(y) - gap(x) || byTitle(x.mine, y.mine))
    .slice(0, SHOWN.disagreements)
    .map(pair);

  let percent: number | null = null;
  if (both.length >= MIN_BOTH_SCORED) {
    const r =
      correlation(both.map(({ mine, theirs }) => [mine.score100, theirs.score100])) ?? TYPICAL;
    const weight = both.length / (both.length + CONFIDENCE);
    percent = Math.min(100, Math.max(0, Math.round(50 + SPREAD * (r - TYPICAL) * weight)));
  }

  return {
    percent,
    inCommon,
    bothScored: both.length,
    bothLoved,
    disagreements,
    picksForA: picks(b, averageB, seenByA, new Set(a.planned), shown),
    picksForB: picks(a, averageA, seenByB, new Set(b.planned), shown),
  };
}

/** The anime someone scored highest, those AniList users rate higher first among equal scores */
export function favoriteAnime(
  profile: TasteProfile,
  { showMature = false }: { showMature?: boolean } = {}
): ScoredAnime[] {
  return profile.scored.filter((anime) => showMature || !anime.isAdult).sort(byFavorite);
}

function byFavorite(x: ScoredAnime, y: ScoredAnime) {
  return y.score100 - x.score100 || (y.meanScore ?? 0) - (x.meanScore ?? 0) || byTitle(x, y);
}

/** What someone scored above their average that the other hasn't watched, their favorites first */
function picks(
  from: TasteProfile,
  fromAverage: number,
  seen: Set<number>,
  planned: Set<number>,
  shown: (anime: ScoredAnime) => boolean
): MatchPick[] {
  return from.scored
    .filter((anime) => anime.score100 > fromAverage && !seen.has(anime.id) && shown(anime))
    .sort(byFavorite)
    .slice(0, SHOWN.picks)
    .map((anime) => ({ anime, planned: planned.has(anime.id) }));
}

function byTitle(x: ScoredAnime, y: ScoredAnime) {
  return x.title.localeCompare(y.title) || x.id - y.id;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * Pearson's correlation of the pairs of scores, from -1 (opposite) to 1 (the same order). Null
 * when someone gave all of them the same score: that says nothing either way
 */
function correlation(pairs: [number, number][]): number | null {
  const meanX = average(pairs.map(([x]) => x));
  const meanY = average(pairs.map(([, y]) => y));
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of pairs) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  return varianceX && varianceY ? covariance / Math.sqrt(varianceX * varianceY) : null;
}

/** Whether a name could be an AniList user's: one word of letters and digits */
export function isUserName(name: string): boolean {
  return /^[\p{L}\p{N}_-]{1,32}$/u.test(name);
}

/**
 * The AniList name in what someone typed: the name itself, with or without an @, or a link to
 * their profile or list. Null when there's no name in it
 */
export function parseUserName(input: string): string | null {
  const text = input.trim();
  const link = text.match(/anilist\.co\/user\/([^/?#\s]+)/i);
  let name = link ? link[1] : text.replace(/^@/, '');
  try {
    name = decodeURIComponent(name);
  } catch {
    return null;
  }
  return isUserName(name) ? name : null;
}

/** Where to compare `name`'s taste with `other`'s, or with anyone's when `other` is left out */
export function matchPath(name: string, other?: string) {
  const path = `/user/anilist/${encodeURIComponent(name)}/match`;
  return other ? `${path}/${encodeURIComponent(other)}` : path;
}

export type TasteProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: TasteProfile }
  /** No such user, or their list is private */
  | { status: 'missing' }
  /** AniList is busy until `retryAt`, as Unix time in ms */
  | { status: 'busy'; retryAt: number }
  | { status: 'failed' };

/**
 * Reads someone's taste profile in the browser. Names are sent in lower case, as AniList ignores
 * case, so every spelling of a name shares one cached profile
 */
export async function loadTasteProfile(
  name: string,
  fetcher: typeof fetch = fetch
): Promise<Exclude<TasteProfileState, { status: 'loading' }>> {
  try {
    const response = await fetcher(`/api/taste/${encodeURIComponent(name.toLowerCase())}`);
    if (response.ok) return { status: 'ready', profile: await response.json() };
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
