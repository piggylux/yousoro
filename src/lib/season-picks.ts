import type { RecommendedAnime, RelatedAnime, SeasonAnime } from '#lib/anime-search.js';
import type { Domain } from '#lib/types/domain.js';
import type { SeasonTaste, TasteTrait, TraitKind } from '#lib/types/season.js';

/**
 * Ranking a season's anime for one person: by whether they've seen and liked the anime AniList
 * users recommend to its fans, once it airs; by how they score anime of the same themes, studios
 * and genres; by whether it continues something they've watched; and by how popular and well rated
 * it is across AniList, which settles the rest. Worked out in the browser, from the season's lineup
 * and one read of their list
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
  /**
   * Whether recommendations by AniList users moved any of the picks: some are recommended to fans
   * of anime on their lists. Never before a season airs, as AniList only takes them then
   */
  byRecommendations: boolean;
};

/** How many new anime "Picked for you" shows */
export const PICKS = 8;
/** Scores to go by: fewer, and a trait's average says more about luck than taste */
export const MIN_SCORED = 5;
/** Anime watched to go by when there are too few scores: how often each trait comes up */
export const MIN_WATCHED = 10;

// How much each part of the fit counts. Taste counts most; sequels decide what continues and what
// can wait; popularity and AniList's score settle the rest
const TASTE_WEIGHT = 1.5;
const SHRINK = 3;
const FAMILIARITY = 0.3;
// As if every anime also had this much weight of traits they're indifferent to, so one known by a
// trait or two stays near the middle rather than rising on one strong trait
const PRIOR = 6;
// AniList has 18 genres and most anime have three or four, so a genre says less of an anime than a
// theme it's tagged with or the studio that made it, and counts for half as much
const GENRE_WEIGHT = 0.5;
const STUDIO_WEIGHT = 1;
// A theme counts by how central it is to the anime: fully at AniList's rank of 100
const TAG_WEIGHT = 1;
const MIN_TAG_RANK = 50;
const CONTINUES = 1.5;
const CONTINUES_LOVED = 0.5;
const SIDE_STORY = 0.4;
const DROPPED = -1;
const UNSEEN_START = -0.6;
const POPULARITY_WEIGHT = 0.4;
const SCORE_WEIGHT = 0.2;
// The anime AniList users recommend to its fans: how much of that they've seen, and how they rated
// what they saw, trusted more the more they've seen. Once a season airs, this says more of what
// they'll watch and like than its themes and genres do
const RECOMMENDED_SEEN = 0.5;
const RECOMMENDED_RATING = 0.25;
const RECOMMENDED_PRIOR = 1;
// Ratings, in standard deviations of their scores: as far as one counts either way, and what
// dropping or pausing an anime without scoring it says
const MAX_RATING = 2.5;
const DROPPED_RATING = -1.5;
const PAUSED_RATING = -0.3;
// Half a point on a 10-point scale: scores that spread less than this would make a point's
// difference look like the gap between a favourite and a dud
const MIN_DEVIATION = 5;
// What makes a trait worth naming as a reason: a clear lift, over enough anime
const REASON_LIFT = 0.2;
const REASON_COUNT = 3;
// Scores this far above their own average, out of 100, count as loved, and as liked
const LOVED_ABOVE = 10;
const LIKED_ABOVE = 5;
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
  const deviation = Math.max(MIN_DEVIATION, deviationOf(taste?.scores ?? []));

  /**
   * How much someone liked an anime they've seen, in standard deviations of their scores from
   * their average, so it means the same whatever their score format. Unscored, only dropping or
   * pausing it says anything; anime they haven't seen, or only plan to, are null
   */
  const ratingOf = (key: number | null) => {
    const status = key === null ? undefined : lists.get(key);
    if (status === undefined || status === 'PLANNING') return null;
    const score = scores.get(key!) ?? 0;
    if (scoredEnough && score > 0 && mean !== null) {
      const rating = (score - mean) / deviation;
      return { status, score, rating: Math.max(-MAX_RATING, Math.min(MAX_RATING, rating)) };
    }
    const rating = status === 'DROPPED' ? DROPPED_RATING : status === 'PAUSED' ? PAUSED_RATING : 0;
    return { status, score, rating };
  };

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
    // Reasons go by tier, then strength: what it continues, then whose fans it's recommended to,
    // then the themes, studios and genres they score highly, then how it does across AniList
    const reasons: { text: string; tier: number; strength: number }[] = [];
    let note: string | null = null;
    let fit = 0;
    let continuing = false;

    // The anime AniList users recommend to its fans: how much of that they've seen, and how they
    // rated what they saw, the most agreed-with recommendations counting most. The one named is
    // the one they liked best, the most agreed with among equals. Its own earlier parts, which a
    // sequel is often recommended with, are left to what it continues, which counts them already
    const ownParts = new Set([...anime.prequelLinks, ...anime.parentLinks].map(({ id }) => id));
    let recommendedWeight = 0;
    let seenWeight = 0;
    let seenRating = 0;
    let fanOf: { link: RecommendedAnime; liked: Liked; weight: number } | null = null;
    for (const link of tasteKnown ? anime.recommendations : []) {
      if (ownParts.has(link.id)) continue;
      const weight = Math.log1p(link.rating);
      recommendedWeight += weight;
      const seen = ratingOf(keyOf(link));
      if (!seen) continue;
      seenWeight += weight;
      seenRating += weight * seen.rating;
      const liked = likedOf(seen, mean);
      if (!liked) continue;
      const order = LIKING[liked] - (fanOf ? LIKING[fanOf.liked] : -1);
      if (order > 0 || (order === 0 && weight > fanOf!.weight)) fanOf = { link, liked, weight };
    }
    if (recommendedWeight) {
      fit +=
        (RECOMMENDED_SEEN * seenWeight) / recommendedWeight +
        (RECOMMENDED_RATING * seenRating) / (seenWeight + RECOMMENDED_PRIOR);
    }
    if (fanOf) {
      reasons.push({
        text: recommendedReason(fanOf.link, fanOf.liked, voice),
        tier: 1,
        strength: 0,
      });
    }

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
      const loved = likedOf({ status: seen.status!, score: seen.score }, mean) === 'loved';
      fit += CONTINUES + (loved ? CONTINUES_LOVED : 0);
      reasons.push({
        text: continuesReason(seen.link, seen.status!, loved, voice),
        tier: 0,
        strength: 0,
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
          tier: 0,
          strength: 0,
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
        tier: 2,
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
        reasons.push({ text: "One of the season's most popular", tier: 3, strength: 0 });
      } else if ((anime.averageScore ?? 0) >= WELL_RATED) {
        reasons.push({ text: `AniList average ${anime.averageScore}%`, tier: 3, strength: 0 });
      }
    }

    const pick: SeasonPick = {
      anime,
      fit,
      reasons: reasons
        .sort((a, b) => a.tier - b.tier || b.strength - a.strength)
        .slice(0, 2)
        .map(({ text }) => text),
      note,
    };
    const key = keyOf(anime);
    return {
      pick,
      continuing,
      listed: key !== null && lists.has(key),
      recommended: seenWeight > 0,
    };
  });

  const byFit = (a: (typeof ranked)[number], b: (typeof ranked)[number]) =>
    b.pick.fit - a.pick.fit || b.pick.anime.popularity - a.pick.anime.popularity;
  ranked.sort(byFit);
  const picks = tasteKnown
    ? ranked
        .filter(({ continuing, listed, pick }) => !continuing && !listed && pick.note === null)
        .slice(0, PICKS)
    : [];
  return {
    continuing: ranked.filter(({ continuing }) => continuing).map(({ pick }) => pick),
    picks: picks.map(({ pick }) => pick),
    all: ranked.map(({ pick }) => pick),
    tasteKnown,
    byScores: scoredEnough,
    byRecommendations: picks.some(({ recommended }) => recommended),
  };
}

/** Lists that mean they've seen at least some of an anime */
const WATCHED = new Set(['COMPLETED', 'CURRENT', 'REPEATING', 'PAUSED']);

/** The standard deviation of someone's scores out of 100; 0 with fewer than two */
function deviationOf(scores: SeasonTaste['scores']): number {
  if (scores.length < 2) return 0;
  const mean = scores.reduce((total, [, score]) => total + score, 0) / scores.length;
  return Math.sqrt(
    scores.reduce((total, [, score]) => total + (score - mean) ** 2, 0) / scores.length
  );
}

/** What someone made of an anime, as a reason says it, and which is the better to name */
type Liked = 'loved' | 'liked' | 'finished' | 'watching';
const LIKING: Record<Liked, number> = { loved: 2, liked: 1, finished: 0, watching: 0 };

/**
 * What someone made of an anime they've seen, when it's worth naming: loved or liked by their
 * score, or else finished or being watched, unless they scored it below their average; null for
 * one they dropped, paused or didn't like
 */
function likedOf(
  { status, score }: { status: string; score: number },
  mean: number | null
): Liked | null {
  if (score > 0 && mean !== null) {
    if (score >= mean + LOVED_ABOVE) return 'loved';
    if (score >= mean + LIKED_ABOVE) return 'liked';
    if (score < mean) return null;
  }
  if (status === 'COMPLETED' || status === 'REPEATING') return 'finished';
  return status === 'CURRENT' ? 'watching' : null;
}

/** What someone did with an anime, as a reason says it: "you loved", "Alice is watching" */
function didWith(what: Liked | 'paused', voice: Voice): string {
  const who = subject(voice);
  return what === 'watching' ? `${who} ${verb(voice, 'are', 'is')} watching` : `${who} ${what}`;
}

/** Why an anime fits its fans: "For fans of Mushishi, which you loved" */
function recommendedReason(link: RelatedAnime, liked: Liked, voice: Voice): string {
  return `For fans of ${link.title}, which ${didWith(liked, voice)}`;
}

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
    ...anime.genres.map((name) => ({ kind: 'genre' as const, name, weight: GENRE_WEIGHT })),
    ...anime.tags
      .filter(({ rank }) => rank >= MIN_TAG_RANK)
      .map(({ name, rank }) => ({ kind: 'tag' as const, name, weight: (rank / 100) * TAG_WEIGHT })),
    ...anime.studios.map((name) => ({ kind: 'studio' as const, name, weight: STUDIO_WEIGHT })),
  ];
}

/** Why a new part of something watched is here: "Continues Dandadan, which you loved" */
function continuesReason(link: RelatedAnime, status: string, loved: boolean, voice: Voice): string {
  const what = loved
    ? 'loved'
    : status === 'COMPLETED'
      ? 'finished'
      : status === 'PAUSED'
        ? 'paused'
        : 'watching';
  return `Continues ${link.title}, which ${didWith(what, voice)}`;
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
