import type { RelatedAnime, SeasonAnime } from '#lib/anime-search.js';
import type { Domain } from '#lib/types/domain.js';
import type { SeasonTaste, TasteTrait, TraitKind } from '#lib/types/season.js';

/**
 * Ranking a season's anime for one person: by how they score anime of the same genres, themes and
 * studios, whether it continues something they've watched, and how popular and well rated it is
 * across AniList, which settles the rest. Worked out in the browser, from the season's lineup and
 * one read of their list
 */

/** An anime of the season, with how well it fits and why it's where it is */
export type SeasonPick = {
  anime: SeasonAnime;
  /** How well it fits: only the order it gives means anything */
  fit: number;
  /** Why it fits, the strongest reason first; at most two */
  reasons: string[];
  /** Something to know first: an earlier part to watch, or one they dropped */
  note: string | null;
};

export type RankedSeason = {
  /** New parts of anime they've watched or are watching, the best fit first */
  continuing: SeasonPick[];
  /**
   * The best fits that are new to them: on none of their lists, and starting a story rather than
   * continuing one. Empty when their list says too little of their taste
   */
  picks: SeasonPick[];
  /** The whole season, the best fit first */
  all: SeasonPick[];
  /** Whether their list says enough of their taste to rank by it */
  tasteKnown: boolean;
  /**
   * Whether that's from how they score anime; otherwise, with too few scores, from how often each
   * genre, theme and studio comes up on their list
   */
  byScores: boolean;
};

/** How many new anime "Picked for you" shows */
export const PICKS = 8;
/** Scores to go by: fewer, and a trait's average says more about luck than taste */
export const MIN_SCORED = 5;
/** Anime watched to go by when there are too few scores: how often each trait comes up */
export const MIN_WATCHED = 10;

// How much each part of the fit counts. Taste counts most; sequels decide what continues and what
// can wait; popularity and AniList's score settle the rest
const TASTE_WEIGHT = 2;
const SHRINK = 3;
const FAMILIARITY = 0.3;
const PRIOR = 2;
const TAG_WEIGHT = 0.8;
const MIN_TAG_RANK = 50;
const CONTINUES = 1.5;
const CONTINUES_LOVED = 0.5;
const SIDE_STORY = 0.4;
const DROPPED = -1;
const UNSEEN_START = -0.6;
const POPULARITY_WEIGHT = 0.4;
const SCORE_WEIGHT = 0.2;
// What makes a trait worth naming as a reason: a clear lift, over enough anime
const REASON_LIFT = 0.2;
const REASON_COUNT = 3;
// Scores this far above their own average, out of 100, count as loved
const LOVED_ABOVE = 10;
// The share of a season's anime the "most popular" are
const MOST_POPULAR = 0.1;
const WELL_RATED = 75;

/** Who the reasons speak of: the viewer themselves, or the list's owner by name */
export type Voice = { name: string | null };

const subject = ({ name }: Voice, start = false) => name ?? (start ? 'You' : 'you');
const verb = ({ name }: Voice, plural: string, singular: string) => (name ? singular : plural);

const traitKey = (kind: TraitKind, name: string) => `${kind}:${name.toLowerCase()}`;

/** What each trait is called in a reason */
const KIND_NAMES: Record<TraitKind, string> = { genre: 'genre', tag: 'theme', studio: 'studio' };

/**
 * The season ranked for someone. Their lists key anime by AniList id on AniList and by MyAnimeList
 * id on MyAnimeList, which the lineup has both of. Without their taste, as when it couldn't be
 * read, the season goes by popularity and AniList's score alone
 */
export function rankSeason(
  lineup: SeasonAnime[],
  taste: SeasonTaste | null,
  { domain, voice = { name: null } }: { domain: Domain; voice?: Voice }
): RankedSeason {
  const keyOf = (anime: { id: number; malId: number | null }) =>
    domain === 'anilist' ? anime.id : anime.malId;
  const lists = listsOf(taste);
  const scores = new Map(taste?.scores ?? []);
  const traits = new Map(
    (taste?.traits ?? []).map((trait) => [traitKey(trait.kind, trait.name), trait])
  );
  const scoredEnough = (taste?.scored ?? 0) >= MIN_SCORED;
  const tasteKnown = scoredEnough || (taste?.watched ?? 0) >= MIN_WATCHED;
  const watched = Math.max(1, taste?.watched ?? 0);
  const mean = taste?.mean100 ?? null;

  /** How much someone likes a trait: its lift, shrunk when few anime have it, and how common it is */
  const affinity = (trait: TasteTrait | undefined) => {
    if (!trait || !tasteKnown) return 0;
    const lift =
      scoredEnough && trait.lift !== null ? trait.lift * (trait.count / (trait.count + SHRINK)) : 0;
    return lift + FAMILIARITY * Math.min(1, trait.count / watched);
  };

  // Where each stands in the season by popularity, from 0 for the least popular to 1 for the most;
  // anime as popular as each other stand together
  const below = new Map<number, number>();
  lineup
    .map(({ popularity }) => popularity)
    .sort((a, b) => a - b)
    .forEach((popularity, index) => {
      if (!below.has(popularity)) below.set(popularity, index);
    });
  const popularityRank = (anime: SeasonAnime) =>
    lineup.length > 1 ? (below.get(anime.popularity) ?? 0) / (lineup.length - 1) : 1;

  const ranked = lineup.map((anime) => {
    const reasons: { text: string; strength: number }[] = [];
    let note: string | null = null;
    let fit = 0;
    let continuing = false;

    // Taste: the average affinity of its traits, each weighed by how much it says of the anime
    const weighed = traitsOf(anime).map(({ kind, name, weight }) => {
      const trait = traits.get(traitKey(kind, name));
      return { kind, name, weight, trait, affinity: affinity(trait) };
    });
    const totalWeight = weighed.reduce((total, { weight }) => total + weight, 0);
    fit +=
      (TASTE_WEIGHT *
        weighed.reduce((total, { weight, affinity }) => total + weight * affinity, 0)) /
      (totalWeight + PRIOR);

    // What it continues: a new part of something watched comes first, one that needs an earlier
    // part watched first can wait, and so can one whose earlier part they dropped
    const prequels = anime.prequelLinks.flatMap((link) => {
      const key = keyOf(link);
      return key === null
        ? []
        : [{ link, status: lists.get(key) ?? null, score: scores.get(key) ?? 0 }];
    });
    const seen = prequels.find(({ status }) => status !== null && WATCHED.has(status));
    const dropped = prequels.find(({ status }) => status === 'DROPPED');
    if (seen) {
      continuing = true;
      const loved = seen.score > 0 && seen.score >= (mean ?? 75) + LOVED_ABOVE;
      fit += CONTINUES + (loved ? CONTINUES_LOVED : 0);
      reasons.push({
        text: continuesReason(seen.link, seen.status!, loved, voice),
        strength: Infinity,
      });
    } else if (dropped) {
      fit += DROPPED;
      note = `${subject(voice, true)} dropped ${dropped.link.title}`;
    } else if (prequels.length) {
      fit += UNSEEN_START;
      note = `Continues ${prequels[0].link.title}: start there`;
    } else if (anime.prequelLinks.length) {
      // Its earlier part isn't on MyAnimeList, so whether they've seen it can't be told: it's
      // only said, and kept out of the new picks, as it's no place to start a story
      note = `Continues ${anime.prequelLinks[0].title}`;
    } else {
      const parent = anime.parentLinks.find((link) => {
        const key = keyOf(link);
        const status = key === null ? undefined : lists.get(key);
        return status !== undefined && WATCHED.has(status);
      });
      if (parent) {
        fit += SIDE_STORY;
        reasons.push({
          text: `A side story of ${parent.title}, which ${subject(voice)} watched`,
          strength: Infinity,
        });
      }
    }

    // Traits worth naming: the strongest, then the strongest of another kind
    const named = weighed
      .filter(
        ({ trait }) =>
          scoredEnough &&
          trait !== undefined &&
          trait.lift !== null &&
          trait.lift >= REASON_LIFT &&
          trait.count >= REASON_COUNT
      )
      .sort((a, b) => b.weight * b.affinity - a.weight * a.affinity);
    const first = named[0];
    const second = named.find(({ kind }) => kind !== first?.kind);
    for (const pick of [first, second]) {
      if (!pick) continue;
      reasons.push({
        text: traitReason(pick.kind, pick.name, voice),
        strength: pick.weight * pick.affinity,
      });
    }

    // Across AniList: how many have it on a list, and how well it's rated once it airs
    const popularity = popularityRank(anime);
    fit += POPULARITY_WEIGHT * popularity;
    if (anime.averageScore !== null) {
      fit += SCORE_WEIGHT * Math.max(-1, Math.min(1, (anime.averageScore - 70) / 10));
    }
    if (reasons.length < 2) {
      if (popularity >= 1 - MOST_POPULAR) {
        reasons.push({ text: "One of the season's most popular", strength: 0 });
      } else if ((anime.averageScore ?? 0) >= WELL_RATED) {
        reasons.push({ text: `AniList average ${anime.averageScore}%`, strength: 0 });
      }
    }

    const pick: SeasonPick = {
      anime,
      fit,
      reasons: reasons
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 2)
        .map(({ text }) => text),
      note,
    };
    const key = keyOf(anime);
    return { pick, continuing, listed: key !== null && lists.has(key) };
  });

  const byFit = (a: (typeof ranked)[number], b: (typeof ranked)[number]) =>
    b.pick.fit - a.pick.fit || b.pick.anime.popularity - a.pick.anime.popularity;
  ranked.sort(byFit);
  return {
    continuing: ranked.filter(({ continuing }) => continuing).map(({ pick }) => pick),
    picks: tasteKnown
      ? ranked
          .filter(({ continuing, listed, pick }) => !continuing && !listed && pick.note === null)
          .slice(0, PICKS)
          .map(({ pick }) => pick)
      : [],
    all: ranked.map(({ pick }) => pick),
    tasteKnown,
    byScores: scoredEnough,
  };
}

/** Lists that mean they've seen at least some of an anime */
const WATCHED = new Set(['COMPLETED', 'CURRENT', 'REPEATING', 'PAUSED']);

/** The list each anime is on, by AniList's names for lists */
function listsOf(taste: SeasonTaste | null): Map<number, string> {
  const lists = new Map<number, string>();
  if (!taste) return lists;
  for (const [list, ids] of Object.entries(taste.listedIds)) {
    for (const id of ids ?? []) lists.set(id, list);
  }
  for (const { id, rewatching } of taste.watching)
    lists.set(id, rewatching ? 'REPEATING' : 'CURRENT');
  return lists;
}

/** An anime's traits, each with how much it says of the anime */
function traitsOf(anime: SeasonAnime): { kind: TraitKind; name: string; weight: number }[] {
  return [
    ...anime.genres.map((name) => ({ kind: 'genre' as const, name, weight: 1 })),
    ...anime.tags
      .filter(({ rank }) => rank >= MIN_TAG_RANK)
      .map(({ name, rank }) => ({ kind: 'tag' as const, name, weight: (rank / 100) * TAG_WEIGHT })),
    ...anime.studios.map((name) => ({ kind: 'studio' as const, name, weight: 1 })),
  ];
}

/** Why a new part of something watched is here: "Continues Dandadan, which you loved" */
function continuesReason(link: RelatedAnime, status: string, loved: boolean, voice: Voice): string {
  const who = subject(voice);
  const what = loved
    ? `${who} loved`
    : status === 'COMPLETED'
      ? `${who} finished`
      : status === 'PAUSED'
        ? `${who} paused`
        : `${who} ${verb(voice, 'are', 'is')} watching`;
  return `Continues ${link.title}, which ${what}`;
}

/** Why a trait makes an anime fit: "From MAPPA, a studio you score highly" */
function traitReason(kind: TraitKind, name: string, voice: Voice): string {
  const scores = `${subject(voice)} ${verb(voice, 'score', 'scores')} highly`;
  return kind === 'studio'
    ? `From ${name}, a studio ${scores}`
    : `${name}, a ${KIND_NAMES[kind]} ${scores}`;
}

/** The orders the whole season can be shown in */
export const SEASON_SORTS = {
  fit: 'Best fit',
  popular: 'Most popular',
  score: 'AniList score',
  start: 'Starting soonest',
} as const;
export type SeasonSort = keyof typeof SEASON_SORTS;

// When an anime starts, as a sortable number; one whose start isn't known goes last
const startsOn = ({ startDate: { year, month, day } }: SeasonAnime) =>
  year === null ? Infinity : year * 10_000 + (month ?? 13) * 100 + (day ?? 32);

/**
 * The season in another order than its fit: the most popular first, the best rated by AniList
 * first, those not rated yet last, or the first to start first. The most popular settles ties
 */
export function sortSeason(picks: SeasonPick[], sort: SeasonSort): SeasonPick[] {
  if (sort === 'fit') return picks;
  const byPopularity = (a: SeasonPick, b: SeasonPick) => b.anime.popularity - a.anime.popularity;
  const order: Record<Exclude<SeasonSort, 'fit'>, (a: SeasonPick, b: SeasonPick) => number> = {
    popular: byPopularity,
    score: (a, b) =>
      (b.anime.averageScore ?? -1) - (a.anime.averageScore ?? -1) || byPopularity(a, b),
    start: (a, b) => startsOn(a.anime) - startsOn(b.anime) || byPopularity(a, b),
  };
  return [...picks].sort(order[sort]);
}

/** The genres of a season's anime, with how many have each, the most common first */
export function seasonGenres(lineup: SeasonAnime[]): { genre: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { genres } of lineup) {
    for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return [...counts]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}
