import { retryAfterSeconds } from '#lib/read-retry.js';
import { type Domain, isDomain, listPath, type ListOwner } from '#lib/types/domain.js';
import type {
  AnimeIds,
  ListedAnime,
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
  const key = animeKey([a, b]);
  const shown = (anime: ScoredAnime) => showMature || !anime.isAdult;
  const scoredByB = new Map(b.scored.map((anime) => [key(anime), anime]));
  const both = a.scored.flatMap((anime) => {
    const theirs = scoredByB.get(key(anime));
    return theirs ? [{ mine: anime, theirs }] : [];
  });

  const seenByA = seenBy(a, key);
  const seenByB = seenBy(b, key);
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
  const byTitle = titleOrder(key);
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
    picksForA: picks(b, averageB, seenByA, plannedBy(a, key), shown, key),
    picksForB: picks(a, averageA, seenByB, plannedBy(b, key), shown, key),
  };
}

/**
 * How anime are told apart when comparing these people's lists. Among AniList lists, by AniList's
 * id, as it knows every anime on them. Otherwise by MyAnimeList's, as AniList knows it for most of
 * its anime and a MyAnimeList list knows only those; an AniList anime MyAnimeList doesn't have
 * keeps AniList's, so it can't be anyone's on MyAnimeList
 */
export function animeKey(profiles: Pick<TasteProfile, 'domain'>[]): (anime: AnimeIds) => string {
  return profiles.every(({ domain }) => domain === 'anilist')
    ? (anime) => `anilist:${anime.id}`
    : (anime) => (anime.malId !== null ? `myanimelist:${anime.malId}` : `anilist:${anime.id}`);
}

/** Every anime someone has watched some or all of, scored or not */
function seenBy(profile: TasteProfile, key: (anime: AnimeIds) => string) {
  return new Set([...profile.seen, ...profile.scored].map(key));
}

/** The anime someone scored highest, those rated higher on their service first among equal scores */
export function favoriteAnime(
  profile: TasteProfile,
  { showMature = false }: { showMature?: boolean } = {}
): ScoredAnime[] {
  return profile.scored
    .filter((anime) => showMature || !anime.isAdult)
    .sort(favoriteOrder(animeKey([profile])));
}

function favoriteOrder(key: (anime: AnimeIds) => string) {
  const byTitle = titleOrder(key);
  return (x: ScoredAnime, y: ScoredAnime) =>
    y.score100 - x.score100 || (y.meanScore ?? 0) - (x.meanScore ?? 0) || byTitle(x, y);
}

/** What someone scored above their average that the other hasn't watched, their favorites first */
function picks(
  from: TasteProfile,
  fromAverage: number,
  seen: Set<string>,
  planned: Set<string>,
  shown: (anime: ScoredAnime) => boolean,
  key: (anime: AnimeIds) => string
): MatchPick[] {
  return from.scored
    .filter((anime) => anime.score100 > fromAverage && !seen.has(key(anime)) && shown(anime))
    .sort(favoriteOrder(key))
    .slice(0, SHOWN.picks)
    .map((anime) => ({ anime, planned: planned.has(key(anime)) }));
}

function plannedBy(profile: TasteProfile, key: (anime: AnimeIds) => string) {
  return new Set(profile.planned.map(key));
}

/** By title, and among the same titles, always in one order */
export function titleOrder(key: (anime: AnimeIds) => string) {
  return (x: ListedAnime, y: ListedAnime) =>
    x.title.localeCompare(y.title) || key(x).localeCompare(key(y));
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

/** Whether a name could be an AniList or MyAnimeList user's: one word of letters and digits */
export function isUserName(name: string): boolean {
  return /^[\p{L}\p{N}_-]{1,32}$/u.test(name);
}

/**
 * Whether two lists are one person's: one AniList account, which may go by another name since, or
 * one MyAnimeList name, as MyAnimeList doesn't say whose list it is
 */
export function samePerson(
  a: Pick<TasteProfile, 'domain' | 'id' | 'name'>,
  b: Pick<TasteProfile, 'domain' | 'id' | 'name'>
): boolean {
  if (a.domain !== b.domain) return false;
  return a.id !== null && b.id !== null
    ? a.id === b.id
    : a.name.toLowerCase() === b.name.toLowerCase();
}

/** Whether two people are the same by service and name, which both ignore the case of */
export function sameName(a: ListOwner, b: ListOwner): boolean {
  return a.domain === b.domain && a.name.toLowerCase() === b.name.toLowerCase();
}

const PROFILE_LINKS: [Domain, RegExp][] = [
  ['anilist', /anilist\.co\/user\/([^/?#\s]+)/i],
  ['myanimelist', /myanimelist\.net\/(?:profile|animelist)\/([^/?#\s]+)/i],
];

/**
 * The person in what someone typed: a link to their AniList or MyAnimeList profile or list, or a
 * name, with or without an @, on the page's own service. Null when there's no name in it
 */
export function parsePerson(input: string, pageDomain: Domain): ListOwner | null {
  const text = input.trim();
  for (const [domain, pattern] of PROFILE_LINKS) {
    const link = text.match(pattern);
    if (link) return person(domain, link[1]);
  }
  return parsePersonSegment(text.replace(/^@/, ''), pageDomain, true);
}

function person(domain: Domain, name: string): ListOwner | null {
  try {
    name = decodeURIComponent(name);
  } catch {
    return null;
  }
  return isUserName(name) ? { domain, name } : null;
}

/**
 * Someone in a path after the page's own person: their name when they're on the page's service,
 * or the service and their name, as `myanimelist:name`, when they're on the other
 */
export function personSegment(person: ListOwner, pageDomain: Domain): string {
  const name = encodeURIComponent(person.name);
  return person.domain === pageDomain ? name : `${person.domain}:${name}`;
}

/**
 * The person in a path segment from `personSegment`, already decoded as the router hands it over,
 * unless `encoded`. Null when it names no service or no name either could have
 */
export function parsePersonSegment(
  segment: string,
  pageDomain: Domain,
  encoded = false
): ListOwner | null {
  const separator = segment.indexOf(':');
  const domain = separator < 0 ? pageDomain : segment.slice(0, separator);
  const name = segment.slice(separator + 1);
  if (!isDomain(domain)) return null;
  if (encoded) return person(domain, name);
  return isUserName(name) ? { domain, name } : null;
}

/** Where to compare `owner`'s taste with `other`'s, or with anyone's when `other` is left out */
export function matchPath(owner: ListOwner, other?: ListOwner) {
  const path = `${listPath(owner.domain, owner.name)}/match`;
  return other ? `${path}/${personSegment(other, owner.domain)}` : path;
}

/**
 * The viewer's accounts, the one on the page's service first: the one to compare with someone or
 * join their group with, as comparisons on one service miss fewer anime
 */
export function viewerAccounts(
  user: { name: string } | null,
  malUser: { name: string } | null,
  pageDomain: Domain
): ListOwner[] {
  const accounts: ListOwner[] = [
    ...(user ? [{ domain: 'anilist' as const, name: user.name }] : []),
    ...(malUser ? [{ domain: 'myanimelist' as const, name: malUser.name }] : []),
  ];
  return accounts.sort((a, b) => Number(b.domain === pageDomain) - Number(a.domain === pageDomain));
}

/**
 * The person whose taste a match or group page is about, from its path: null for a service that
 * isn't there, or MyAnimeList while it isn't set up
 */
export function pagePerson(domain: string, name: string, malEnabled: boolean): ListOwner | null {
  if (!isDomain(domain) || (domain === 'myanimelist' && !malEnabled)) return null;
  return { domain, name };
}

/** Whether someone can be compared here: MyAnimeList's people only while it's set up */
export function canCompare(person: ListOwner, malEnabled: boolean): boolean {
  return person.domain === 'anilist' || malEnabled;
}

export type TasteProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: TasteProfile }
  /** No such user, or their list is private */
  | { status: 'missing' }
  /** Their list's service is busy until `retryAt`, as Unix time in ms */
  | { status: 'busy'; retryAt: number }
  | { status: 'failed' };

/**
 * Changed with the shape of a taste profile, so neither the browser nor the CDN can answer with a
 * profile they kept from before: they keep each for up to a day
 */
const TASTE_PROFILE_VERSION = 3;

/** Where someone's taste profile is read, by everyone who asks, whatever their name's case */
export function tasteProfilePath(person: ListOwner) {
  const name = encodeURIComponent(person.name.toLowerCase());
  return `/api/taste/${person.domain}/${name}?v=${TASTE_PROFILE_VERSION}`;
}

/**
 * Reads someone's taste profile in the browser. Names are sent in lower case, as both services
 * ignore case, so every spelling of a name shares one cached profile. MyAnimeList doesn't say how
 * its users spell their names, so theirs is kept as it was asked for
 */
export async function loadTasteProfile(
  person: ListOwner,
  fetcher: typeof fetch = fetch
): Promise<Exclude<TasteProfileState, { status: 'loading' }>> {
  try {
    const response = await fetcher(tasteProfilePath(person));
    if (response.ok) {
      const profile: TasteProfile = await response.json();
      return {
        status: 'ready',
        profile: profile.domain === 'anilist' ? profile : { ...profile, name: person.name },
      };
    }
    if (response.status === 404) return { status: 'missing' };
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response.headers.get('Retry-After'));
      return { status: 'busy', retryAt: Date.now() + seconds * 1000 };
    }
  } catch {
    // Offline, or the response wasn't readable: the same as the service not answering
  }
  return { status: 'failed' };
}
