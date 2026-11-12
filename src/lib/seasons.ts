/**
 * Anime seasons, as AniList counts them: winter from January, spring from April, summer from July
 * and fall from October, in the viewer's own time
 */

/** An anime season, as AniList names them */
export type AnimeSeason = { season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'; year: number };
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;

/** The season airing now */
export function currentSeason(now = new Date()): AnimeSeason {
  return { season: SEASONS[Math.floor(now.getMonth() / 3)], year: now.getFullYear() };
}

/** "Fall 2026" */
export function seasonName({ season, year }: AnimeSeason): string {
  return `${season[0]}${season.slice(1).toLowerCase()} ${year}`;
}

/** The season after one: winter of the next year after fall */
export function nextSeason({ season, year }: AnimeSeason): AnimeSeason {
  const index = SEASONS.indexOf(season);
  return index === SEASONS.length - 1
    ? { season: SEASONS[0], year: year + 1 }
    : { season: SEASONS[index + 1], year };
}

/**
 * The season worth looking at first: the one airing now, until its last month, when the next one's
 * lineup is announced and it's time to plan for it
 */
export function defaultSeason(now = new Date()): AnimeSeason {
  const airing = currentSeason(now);
  return now.getMonth() % 3 === 2 ? nextSeason(airing) : airing;
}

/** Whether a season has aired, is airing, or is still to come, in the viewer's own time */
export function seasonTiming(
  season: AnimeSeason,
  now = new Date()
): 'past' | 'airing' | 'upcoming' {
  const order = ({ season, year }: AnimeSeason) => year * 4 + SEASONS.indexOf(season);
  const difference = order(season) - order(currentSeason(now));
  return difference < 0 ? 'past' : difference === 0 ? 'airing' : 'upcoming';
}

/** The month a season starts airing, from 0 for January */
export function seasonStartMonth({ season }: AnimeSeason): number {
  return SEASONS.indexOf(season) * 3;
}

/** A season as a page address names it: "winter-2027" */
export function seasonSlug({ season, year }: AnimeSeason): string {
  return `${season.toLowerCase()}-${year}`;
}

// Anime seasons as AniList counts them start in 1940; one more than a couple of years out has
// nothing announced
const FIRST_SEASON_YEAR = 1940;
const SEASONS_AHEAD = 2;

/** The season a page address names, or null for one that isn't a season with anime to show */
export function parseSeasonSlug(slug: string, now = new Date()): AnimeSeason | null {
  const match = /^(winter|spring|summer|fall)-(\d{4})$/.exec(slug);
  if (!match) return null;
  const year = Number(match[2]);
  if (year < FIRST_SEASON_YEAR || year > now.getFullYear() + SEASONS_AHEAD) return null;
  return { season: match[1].toUpperCase() as AnimeSeason['season'], year };
}
