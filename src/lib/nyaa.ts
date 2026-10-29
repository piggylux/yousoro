import type { DownloadLanguage, DownloadVersion } from '#lib/types/preferences.js';

/** Anime AniList marks as adult are on nyaa.si's sister site for adult releases */
export function nyaaSite(adult: boolean) {
  return adult ? 'sukebei.nyaa.si' : 'nyaa.si';
}

/*
 * nyaa.si's search understands `a|b` for either, `-a` to exclude and `"…"` for an exact phrase.
 * Its words are whatever sits between spaces, punctuation included: "Koupen-chan" is one word,
 * "Girlfriend's" isn't "Girlfriends", and the "-" in "Title - 05" is a word of its own. In a
 * phrase, brackets count too ("2023)" isn't "2023"), but a single word also matches it in
 * brackets: `fr` finds "(FR)". So tags are looked for as single words, never as phrases.
 * Each language is a category of nyaa.si's, and French releases are also told apart by the tags
 * they carry: VOSTFR for subtitles, VF for a dub and MULTi for both audio tracks.
 */
const CATEGORIES: Record<DownloadLanguage, string> = {
  any: '1_0', // Anime, every subcategory
  english: '1_2', // Anime - English-translated
  french: '1_3', // Anime - Non-English-translated
};

// sukebei.nyaa.si has a single Anime category, so English releases are found by their tags
const SUKEBEI_ANIME = '1_1';
const SUKEBEI_LANGUAGE_TERMS: Record<DownloadLanguage, string> = {
  any: '',
  english: '(english|eng)',
  // The French tags below already say the language
  french: '',
};

/*
 * Web releases with several audio tracks say "MULTi … Multi-Audio", but `multi` alone also finds
 * the many "Multi-Subs" releases, which only have subtitles; French ones always add VF. A French
 * MULTi release lists VOSTFR as well, for its subtitles, so a dub can't exclude VOSTFR
 */
const TERMS: Record<DownloadLanguage, Record<DownloadVersion, string>> = {
  any: {
    any: '',
    subbed: '-dub -dubbed -vf',
    dubbed: '(dub|dubbed|(dual audio)|(multi audio)|vf)',
    'dual-audio': '((dual audio)|(multi audio)|(multi vf))',
  },
  english: {
    any: '',
    subbed: '-dub -dubbed',
    dubbed: '(dub|dubbed|(dual audio)|(multi audio))',
    'dual-audio': '((dual audio)|(multi audio))',
  },
  french: {
    any: '(vostfr|vf|vff|french|multi)',
    subbed: 'vostfr',
    dubbed: '(vf|vff|multi)',
    'dual-audio': 'multi',
  },
};

// Release names are in Latin script; titles in Japanese or other scripts would match nothing
const LATIN_TITLE = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u;
// A bracketed part in another script, as in "Pocket Monsters: Mega Voltage (ポケットモンスター …)"
const NON_LATIN_BRACKETS = /\s*[(（][^)）]*[^\p{Script=Latin}\p{N}\p{P}\p{S}\s)）][^)）]*[)）]/gu;
// "Title 2nd Season", "Title Season 2" or "Title S2"
const SEASON = /^(.+?)\s+(?:(\d+)(?:st|nd|rd|th)\s+Season|Season\s+(\d+)|S(\d+))$/i;
// "Title 3" or "Title IV", as AniList often names a later season. Only up to 9, so a number that's
// part of the name, as in "Mob Psycho 100", isn't taken for a season. Some still are, as in "Kaiju
// No. 8", so this is only a guess
const BARE_SEASON = /^(.+?)\s+([2-9]|II|III|IV|V|VI|VII|VIII|IX)$/;
const ROMAN_NUMERALS: Record<string, number> = {
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
};
// Bound the entire encoded query, including filters, and the number of OR clauses. nyaa.si takes
// about a quarter of a second more for each phrase it hasn't cached: 10 phrases take about 2s
export const NYAA_MAX_QUERY_LENGTH = 480;
export const NYAA_SEARCH_TIMEOUT_MS = 12000;
export const NYAA_ATTEMPT_TIMEOUT_MS = 6000;
export const NYAA_CLIENT_TIMEOUT_MS = 15000;
// AniList is asked about a series' other entries for this long at most, out of the search's time.
// A slower answer is still cached for the next search
export const NYAA_SERIES_LOOKUP_MS = 2500;
const MAX_PHRASES = 10;
// When nyaa.si is too slow for a search, the same search with only its first few phrases may
// still answer in time
const LIGHTER_PHRASES = 3;

export const nyaaQueryLength = (text: string) =>
  new URLSearchParams([['q', text]]).toString().length - 2;

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The title without its season, and the season number, when the title names one. `guessed` is
 * for a bare number at the end, which may be part of the name instead
 */
function splitSeason(title: string): { base: string; season: number; guessed: boolean } | null {
  const named = SEASON.exec(title);
  if (named) {
    return {
      base: named[1],
      season: Number(named[2] ?? named[3] ?? named[4]),
      guessed: false,
    };
  }
  const bare = BARE_SEASON.exec(title);
  if (!bare) return null;
  return { base: bare[1], season: ROMAN_NUMERALS[bare[2]] ?? Number(bare[2]), guessed: true };
}

/**
 * A title ready to go in a phrase: accents in one piece (as release names have them), without a
 * part in another script, and without quotes, which would end the phrase early. Without square
 * brackets too, which release names keep for groups and tags: "[Oshi no Ko]" is "Oshi no Ko"
 */
function cleanTitle(title: string) {
  return (
    title
      .normalize('NFC')
      .replace(NON_LATIN_BRACKETS, '')
      .replace(/["\\[\]]/g, ' ')
      // A middle dot between words is a space in release names: "Nikko・Kegon" is "Nikko Kegon"
      .replace(/[・·･]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// Also without dashes around words, as in "Re:ZERO -Starting Life in Another World-", but keeping
// the ones inside a word, as in "Shangri-La"
const withoutPunctuation = (title: string) =>
  title.replace(/['’`:;,.!?()[\]{}]/g, '').replace(/(^|\s)[-–—]+|[-–—]+(?=\s|$)/g, '$1');

/*
 * Every phrase that could name the episode is ranked by how likely release names are to use it,
 * and the search keeps the most likely ones that fit in NYAA_MAX_QUERY_LENGTH. The main titles are
 * the romaji and the English one; an anime can have many other titles, as Pokémon Horizons has one
 * per arc, and those come last. The order follows which phrases matched recent nyaa.si releases:
 * fansubs write "Title - 05", web releases "Title S01E05", and hardly any "Title 05"
 */
const enum Rank {
  /**
   * A main title as written, with a dash and the episode number: "Title - 05", and with its season
   * as "S3", as SubsPlease, one of the most common groups, names seasons: "Title S3 - 05"
   */
  Number,
  /** The same with an episode code: "Title S02E05", "Title - S02E05" */
  Code,
  /** A main title without punctuation, which web releases often drop: "My Girlfriends Friend" */
  Unpunctuated,
  /** The other ways of writing a season ("Season 2", "2nd Season"), and guessed seasons */
  Season,
  /** A main title in brackets after another title: "Pokémon Horizons (Pocket Monsters 2023) - 152" */
  Bracketed,
  /** The episode number without a dash: "Title 05" */
  Dashless,
  /** Another title, with the episode number */
  Other,
  /** Unpadded single-digit episodes are less common, but some groups use them. */
  Unpadded,
}

/**
 * Candidate exact phrases that name one episode, most likely first. Each
 * ends with the episode number or code, with or without a dash, as release names write it
 */
function episodePhrases(
  titles: {
    main: string[];
    other: string[];
    arc?: { title: string; episode: number; season: number };
  },
  episode: number
) {
  /*
   * By lowercase phrase, so each phrase is kept once, at its best rank. Within a rank, the more
   * common layout comes first for every title in turn, so a long title can't use up the budget
   * before the other title gets its most likely form
   */
  const candidates = new Map<
    string,
    { phrase: string; rank: Rank; secondary: boolean; order: number }
  >();
  const add = (rank: Rank, phrase: string, secondary = false) => {
    const key = phrase.toLowerCase();
    const known = candidates.get(key);
    if (known && known.rank <= rank) return;
    candidates.set(key, { phrase, rank, secondary, order: known?.order ?? candidates.size });
  };
  const withNumber = (rank: Rank, name: string, secondary = false) => {
    add(rank, `"${name} - ${pad(episode)}"`, secondary);
    add(rank > Rank.Dashless ? rank : Rank.Dashless, `"${name} ${pad(episode)}"`, true);
    if (episode < 10) {
      // Not "Title 2", which is also how a second season can be named: "Title 2 - 05"
      add(Rank.Unpadded, `"${name} - ${episode}"`);
    }
  };
  // Without a dash first, as web releases write codes: "Title S02E05 1080p WEB-DL"
  const withCode = (rank: Rank, name: string, season: number) => {
    const code = `S${pad(season)}E${pad(episode)}`;
    add(rank, `"${name} ${code}"`);
    add(rank, `"${name} - ${code}"`, true);
  };

  // Spelling by spelling, for every title in turn, as for the layouts within a rank
  const spellings = titles.main.map((title) => titleSpellings(cleanTitle(title)));
  for (let index = 0; index < Math.max(...spellings.map(({ length }) => length)); index++) {
    for (const [titleIndex, spelling] of spellings.map((each) => each[index]).entries()) {
      const asWritten = index === 0;
      if (!spelling || !LATIN_TITLE.test(spelling)) continue;

      // Other spellings of the English title are mostly web releases', which write a code
      withNumber(
        asWritten ? Rank.Number : Rank.Unpunctuated,
        spelling,
        !asWritten && titleIndex > 0
      );
      // A title with brackets of its own is put in brackets without them
      if (!/[()]/.test(spelling)) add(Rank.Bracketed, `"(${spelling}) - ${pad(episode)}"`);

      const codeRank = asWritten ? Rank.Code : Rank.Unpunctuated;
      const season = splitSeason(spelling);
      if (!season) {
        withCode(codeRank, spelling, 1);
        continue;
      }
      const { base, season: number, guessed } = season;
      // "S3" ranks with the title itself, unless the number may just be part of the name
      withNumber(asWritten && !guessed ? Rank.Number : Rank.Season, `${base} S${number}`);
      for (const name of [`${base} Season ${number}`, `${base} ${ordinal(number)} Season`]) {
        withNumber(Rank.Season, name);
      }
      if (guessed) {
        // The number may be part of the name ("Kaiju No. 8"), so the title stays a season 1
        withCode(codeRank, spelling, 1);
        withCode(Rank.Season, base, number);
      } else {
        withCode(codeRank, base, number);
      }
    }
  }
  // The first part's title with the episode numbered on from it, as many release names number a
  // split series: "Kusuriya no Hitorigoto - 52" for the third season's fourth episode. Other
  // layouts and spellings of it found few releases, and took the place of ones that found more
  if (titles.arc) {
    const title = cleanTitle(titles.arc.title);
    if (LATIN_TITLE.test(title)) {
      add(Rank.Number, `"${title} - ${pad(titles.arc.episode)}"`);
      // Or the first part's title with the season the anime is in the series, as web releases
      // number seasons: "Tougen Anki S02E04" for Tougen Anki: Nikko・Kegon no Taki-hen
      const { season } = titles.arc;
      if (season > 1) {
        withCode(Rank.Season, title, season);
        withNumber(Rank.Season, `${title} S${season}`);
      }
    }
  }
  for (const title of titles.other.map(cleanTitle)) {
    for (const spelling of titleSpellings(title)) {
      if (spelling && LATIN_TITLE.test(spelling)) withNumber(Rank.Other, spelling);
    }
  }

  return [...candidates.values()].sort(
    (a, b) => a.rank - b.rank || Number(a.secondary) - Number(b.secondary) || a.order - b.order
  );
}

function titleSpellings(title: string): string[] {
  const plain = cleanTitle(withoutPunctuation(title));
  return [
    ...new Set([
      title,
      // A symbol between words is a dash or a space: "Yu☆Gi☆Oh!" is "Yu-Gi-Oh!", "Lucky☆Star" is
      // "Lucky Star". Not one ending a title, which can tell it from another: "Gintama°"
      cleanTitle(title.replace(/(?<=\p{L})\p{So}+(?=\p{L})/gu, '-')),
      cleanTitle(title.replace(/(?<=\p{L})\p{So}+(?=\p{L})/gu, ' ')),
      // A dash inside a word may be a space instead, as in "Bleach: Sennen Kessen Hen - Kashin Tan"
      title.replace(/(?<=\p{L})-(?=\p{L})/gu, ' '),
      plain,
      // A colon inside a word may be a space instead: "Re:ZERO" is also "Re ZERO"
      cleanTitle(withoutPunctuation(title.replace(/(?<=\p{L}):(?=\p{L})/gu, ' '))),
      plain.normalize('NFD').replace(/\p{M}/gu, ''),
      cleanTitle(plain.replace(/[-–—]/g, ' ')),
    ]),
  ];
}

export type NyaaSearch = {
  /** A full user-written query, replacing the automatic episode terms but keeping the category. */
  query?: string;
  title: string;
  /** The English title, searched as thoroughly as `title` */
  englishTitle?: string | null;
  /** Other names the anime goes by, searched once the main titles are covered */
  otherTitles?: string[];
  episode: number;
  language?: DownloadLanguage;
  version?: DownloadVersion;
  /** Marked as adult on AniList, which searches sukebei.nyaa.si instead */
  adult?: boolean;
  /** The anime's AniList id, which the server looks up the series' other entries with */
  mediaId?: number;
};

/**
 * The first part of a series AniList splits in several entries, and how many episodes come before
 * this one, as many release names number episodes on from earlier parts: the fourth part of
 * Bleach: Thousand-Year Blood War starts at episode 41
 */
export type NyaaArc = {
  offset: number;
  title: string;
  /** Which part of the series the anime is, which web releases often number as its season */
  season: number;
};

/** What a search learns from AniList about the anime and its series, which the server looks up */
export type NyaaSeries = { arc: NyaaArc | null; related: string[]; native?: string | null };

/**
 * A search for the packs of an older series, and the episode they need to include: its number
 * in its own season, and in the whole series when it's numbered on from earlier parts
 */
export type NyaaPacks = {
  query: string;
  episode: number;
  season: number;
  seriesEpisode?: number;
  /** The title phrases, one of which a pack's name must have */
  titles?: string[];
};

/*
 * A search plan, whose searches run together and add up, as more releases matter more than a
 * faster answer: each finds some the others don't
 */
export type NyaaQueryPlan = {
  category: string;
  /** The most likely phrases */
  query: string;
  /** Only the first few phrases of `query`, to try when nyaa.si took too long and found nothing */
  lighter?: string;
  /** The next most likely phrases */
  broader?: string;
  /**
   * The words of the titles, without their season, and the episode's number. nyaa.si matches
   * words loosely and answers them fast, and keeps 75 results, so only the releases one of
   * `phrases` names are kept: every phrase the search could use, beyond what fits in a query. On
   * sukebei.nyaa.si, also those holding one of `titles` anywhere that number `episode` their way
   */
  words?: NyaaWords;
  /**
   * The words of the series' first part and the episode's number in the whole series, for names no
   * phrase can match, as "Bleach S17E50" numbers a season TVDB's way. Only the releases naming
   * `episode` are kept
   */
  seriesNumber?: { query: string; episode: number };
  /**
   * Last, for a series released in packs, as older ones are: its titles without the episode,
   * batches allowed, and without the series' other entries whose titles start the same way, as
   * their newer releases would take every result. Only the packs including the episode are kept
   */
  packs?: NyaaPacks;
};

/**
 * Bounded queries for one episode. Each spelling of the title is an exact phrase that ends with
 * the episode number, laid out the ways release names write it ("Title - 05", "Title S01E05",
 * "Title 05"), so another season ("Title S2 - 05") or a longer title that starts the same way
 * doesn't match. Oversized/non-Latin titles use a bounded word search instead.
 */
export function nyaaQueryPlan(
  {
    query: customQuery,
    title,
    englishTitle,
    otherTitles = [],
    episode,
    language = 'any',
    version = 'any',
    adult = false,
  }: NyaaSearch,
  series?: NyaaSeries | null
): NyaaQueryPlan {
  const arc = series?.arc;
  const category = adult ? SUKEBEI_ANIME : CATEGORIES[language];
  if (customQuery !== undefined) return { category, query: customQuery.trim() };
  const main = englishTitle ? [title, englishTitle] : [title];
  const candidates = episodePhrases(
    {
      main,
      other: otherTitles,
      arc: arc
        ? { title: arc.title, episode: arc.offset + episode, season: arc.season }
        : undefined,
    },
    episode
  );
  const terms = [adult ? SUKEBEI_LANGUAGE_TERMS[language] : '', TERMS[language][version]]
    .filter(Boolean)
    .join(' ');
  const filters = [terms, '-batch'].filter(Boolean).join(' ');
  const format = (phrases: string[]) => `(${phrases.join('|')}) ${filters}`;
  const pack = (phrases: string[]) => {
    const kept: string[] = [];
    for (const phrase of phrases) {
      if (kept.length === MAX_PHRASES) break;
      if (nyaaQueryLength(format([...kept, phrase])) <= NYAA_MAX_QUERY_LENGTH) kept.push(phrase);
    }
    return kept;
  };
  const first = pack(
    candidates.filter(({ rank }) => rank !== Rank.Unpadded).map(({ phrase }) => phrase)
  );
  if (!first.length) {
    // No exact phrase fits (or only non-Latin names exist). Keep whole title words, the episode,
    // and every preference filter. Never let a single huge title bypass the query budget.
    const words = cleanTitle(title)
      .replace(/[|()+~*]/g, ' ')
      .replace(/(^|\s)-+/g, '$1')
      .split(/\s+/)
      .filter(Boolean);
    const kept: string[] = [];
    for (const word of words) {
      if (kept.length === 12) break;
      if (nyaaQueryLength([...kept, word, pad(episode), filters].join(' ')) > NYAA_MAX_QUERY_LENGTH)
        break;
      kept.push(word);
    }
    // A single unbroken title may itself exceed the budget; shorten it by Unicode code point.
    if (!kept.length && words[0]) {
      let prefix = '';
      for (const character of words[0]) {
        if (
          nyaaQueryLength(`${prefix}${character} ${pad(episode)} ${filters}`) >
          NYAA_MAX_QUERY_LENGTH
        )
          break;
        prefix += character;
      }
      kept.push(prefix);
    }
    return { category, query: [...kept, pad(episode), filters].filter(Boolean).join(' ') };
  }
  // Give alternate names a chance before filling the fallback with remaining main-title forms.
  const aliases = candidates
    .filter(({ rank, secondary }) => rank === Rank.Other && !secondary)
    .slice(0, 2);
  const remaining = [...aliases, ...candidates].filter(({ phrase }) => !first.includes(phrase));
  const broader = pack([...new Set(remaining.map(({ phrase }) => phrase))]);
  const plan: NyaaQueryPlan = { category, query: format(first) };
  if (first.length > LIGHTER_PHRASES) plan.lighter = format(first.slice(0, LIGHTER_PHRASES));
  if (broader.length) plan.broader = format(broader);
  // Searches of their own, as nyaa.si doesn't take a group of words as an alternative to phrases.
  // sukebei.nyaa.si's releases often go by the anime's native title, and number episodes "#1" or
  // "第1話", whose word is "1", not "01"
  const native = adult && series?.native ? series.native : null;
  const titles = [
    ...new Set(
      [main[0], native ?? '', ...main.slice(1), arc?.title ?? ''].map((name) =>
        searchWords(splitSeason(cleanTitle(name))?.base ?? name)
      )
    ),
  ].filter((words) => words && (adult || LATIN_TITLE.test(words)));
  const numbers = adult && episode < 10 ? [String(episode), pad(episode)] : [pad(episode)];
  const formatWords = (groups: string[]) =>
    `${groups.length > 1 ? `(${groups.join('|')})` : groups[0]} ${filters}`;
  const groups: string[] = [];
  for (const words of titles) {
    for (const number of numbers) {
      const group = `(${words} ${number})`;
      if (nyaaQueryLength(formatWords([...groups, group])) <= NYAA_MAX_QUERY_LENGTH)
        groups.push(group);
    }
  }
  if (groups.length) {
    // Without the unpadded phrases, as loosely "Title - 2" is also "Title 2 - 05"
    plan.words = {
      query: formatWords(groups),
      phrases: candidates.filter(({ rank }) => rank !== Rank.Unpadded).map(({ phrase }) => phrase),
    };
    if (adult) plan.words.loosely = { titles: native ? [...main, native] : main, episode };
  }
  if (arc) {
    const words = searchWords(arc.title);
    const query = `(${words} ${arc.offset + episode}) ${filters}`;
    if (words && LATIN_TITLE.test(words) && nyaaQueryLength(query) <= NYAA_MAX_QUERY_LENGTH)
      plan.seriesNumber = { query, episode: arc.offset + episode };
  }
  // Another title of a single word is often an abbreviation or the franchise's name, as "SBR" or
  // "Yugioh", which would find unrelated packs without an episode to narrow it down
  const packs = packsQuery(
    [...main, ...otherTitles.filter((other) => cleanTitle(other).includes(' '))],
    series?.related ?? [],
    terms
  );
  if (packs) {
    const season = splitSeason(cleanTitle(title));
    plan.packs = {
      query: packs.query,
      episode,
      season: season && !season.guessed ? season.season : 1,
      titles: packs.phrases,
    };
    if (arc) plan.packs.seriesEpisode = arc.offset + episode;
  }
  return plan;
}

// A title's words for a word search, without the punctuation nyaa.si could take as operators
const searchWords = (title: string) =>
  cleanTitle(title)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * A word search's query and what its releases must have. On sukebei.nyaa.si, `loosely` also takes
 * a name holding one of the titles anywhere, numbering the episode the ways its releases do
 */
export type NyaaWords = {
  query: string;
  phrases: string[];
  loosely?: { titles: string[]; episode: number };
};

// Lowercase, with compatibility forms and without accents: "Fiancé" is "fiance", "＃１" is "#1"
const folded = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
// The same, without spaces and punctuation
const compact = (text: string) => folded(text).replace(/[\s\p{P}\p{S}]+/gu, '');

/** Whether a word search's release names the episode: with a phrase, or on sukebei, loosely */
export function wordsInclude(name: string, { phrases, loosely }: NyaaWords): boolean {
  if (matchesPhrase(name, phrases)) return true;
  if (!loosely || !loosely.titles.some((title) => compact(name).includes(compact(title))))
    return false;
  const { episode } = loosely;
  const text = name.normalize('NFKC');
  return (
    namesEpisode(text, episode) ||
    // "#1", "第1話" or "第1巻", or "Title 1"
    new RegExp(`#\\s*0*${episode}(?!\\d)|第\\s*0*${episode}\\s*[話话巻章]`).test(text) ||
    new RegExp(`(?<![\\p{L}\\p{N}.#-])${episode}(?![\\p{L}\\p{N}]|[.-]\\d)`, 'u').test(text) ||
    // The first and second of two parts
    (episode === 1 && /上巻|前[編篇]/.test(text)) ||
    (episode === 2 && /下巻|後[編篇]/.test(text))
  );
}

// Letters and digits, with a single space for whatever spaces and punctuation are between them
const spaced = (text: string) =>
  folded(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// A phrase's letters and digits in order, with or without a space between them, but not between
// two digits written together, so "05" is neither "0.5" nor part of "050". Matched against
// `spaced` names, as plain spaces compile far faster than Unicode classes
function loosePattern(phrase: string) {
  let pattern = '';
  let previous = '';
  let apart = false;
  for (const character of folded(phrase.slice(1, -1))) {
    if (!/[\p{L}\p{N}]/u.test(character)) {
      apart = true;
      continue;
    }
    if (previous && (apart || !/\d/.test(previous) || !/\d/.test(character))) pattern += ' ?';
    pattern += character;
    previous = character;
    apart = false;
  }
  return pattern;
}
// One pattern for all of a search's phrases, as an anime can have hundreds
const loosePhrases = new WeakMap<string[], RegExp>();

/**
 * Whether a release name has one of the phrases, ignoring the spaces, punctuation and accents
 * release names write differently: "Nano ni" is "nanoni", "Re:ZERO" is "Re ZERO", "Fiancé" is
 * "Fiance", "Tougen.Anki.S02E04" is "Tougen Anki S02E04"
 */
export function matchesPhrase(name: string, phrases: string[]): boolean {
  let pattern = loosePhrases.get(phrases);
  if (!pattern) {
    const each = phrases.map(loosePattern).filter(Boolean);
    pattern = each.length ? new RegExp(`(?<=^| )(?:${each.join('|')})(?:v\\d)?(?= |$)`) : /(?!)/;
    loosePhrases.set(phrases, pattern);
  }
  return pattern.test(spaced(name));
}

const titleWords = (title: string) =>
  title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const startsWithWords = (title: string[], start: string[]) =>
  title.length > start.length && start.every((word, index) => title[index] === word);
const SEASON_WORD = /^(season|saison|part|cour|the|\d+(st|nd|rd|th)?|s\d+|[ivx]+)$/;

/**
 * The titles without the episode. A title another starts with is left out, as a franchise's name
 * ("Yu-Gi-Oh!" for "Yu-Gi-Oh! Duel Monsters") would find all of it. So are the words that go on
 * the titles in the series' other entries ("GX" in "Yu☆Gi☆Oh! Duel Monsters GX")
 */
function packsQuery(
  titles: string[],
  related: string[],
  terms: string
): { query: string; phrases: string[] } | null {
  const names = [...new Set(titles.map(cleanTitle))].filter((title) => LATIN_TITLE.test(title));
  const kept = names.filter(
    (title) => !names.some((other) => startsWithWords(titleWords(other), titleWords(title)))
  );
  const excluded = new Set<string>();
  for (const other of related.map(titleWords)) {
    for (const title of kept.map(titleWords)) {
      const next = other[title.length];
      if (next && next.length > 1 && !SEASON_WORD.test(next) && startsWithWords(other, title))
        excluded.add(`-${next}`);
    }
  }
  const trailing = [terms, ...[...excluded].slice(0, 6)].filter(Boolean).join(' ');
  // A group of phrases needs something after it, or nyaa.si finds nothing
  const format = (phrases: string[]) =>
    trailing ? `(${phrases.join('|')}) ${trailing}` : phrases.join('|');
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const spelling of kept.flatMap(titleSpellings)) {
    const phrase = `"${spelling}"`;
    if (!spelling || !LATIN_TITLE.test(spelling) || seen.has(phrase.toLowerCase())) continue;
    if (phrases.length === MAX_PHRASES) break;
    if (nyaaQueryLength(format([...phrases, phrase])) > NYAA_MAX_QUERY_LENGTH) continue;
    seen.add(phrase.toLowerCase());
    phrases.push(phrase);
  }
  return phrases.length ? { query: format(phrases), phrases } : null;
}

/**
 * Whether a pack's name includes the episode: a range of episodes that covers it ("001-224",
 * "Episodes 001 à 049", "001~224"), or a complete series when it has none. Not when the name
 * says another season, as "S2 (01-48)" numbers its own episodes
 */
export function packIncludes(name: string, packs: NyaaPacks): boolean {
  if (packs.titles && !matchesPhrase(name, packs.titles)) return false;
  const seasons = [
    ...name.matchAll(
      /(?<![\p{L}\p{N}])(?:S|Season\s*|Saison\s*)0*(\d{1,2})(?![\p{N}E])|(?<!\p{N})(\d{1,2})(?:st|nd|rd|th)\s+Season/giu
    ),
  ].map(([, season, ordinal]) => Number(season ?? ordinal));
  // A number from 2 to 9 right after the title, not starting a range, is a season too:
  // "Isekai Quartet 2 (01-12)"
  for (const title of packs.titles ?? []) {
    const after = new RegExp(`(?<=^| )${loosePattern(title)} ([2-9])(?= |$)`).exec(spaced(name));
    if (after && !new RegExp(`(?<!\\d)${after[1]}\\s*(?:-|~|〜|à|to)\\s*\\d`).test(name))
      seasons.push(Number(after[1]));
  }
  if (seasons.length && !seasons.includes(packs.season)) return false;
  // Without a season, the range may number the whole series instead
  const episodes = (seasons.length ? [packs.episode] : [packs.episode, packs.seriesEpisode]).filter(
    (episode) => episode !== undefined
  );
  // From every number, so one ending the title doesn't hide the range: "Kaiju No. 8 - 01-12"
  const ranges = [
    ...name.matchAll(
      /(?<![\p{L}\p{N}.])(?=(\d{1,4})\s*(?:-|~|〜|à|to)\s*(\d{1,4})(?![\p{N}.]))/giu
    ),
  ]
    .map(([, from, to]) => [Number(from), Number(to)])
    // Not years, as in "(2000-2004)"
    .filter(([from, to]) => from < to && !(from >= 1900 && to < 2100));
  if (ranges.length) return ranges.some(([from, to]) => episodes.some((n) => from <= n && n <= to));
  return /(?<!\p{L})(complete|int[ée]grale|integral)(?!\p{L})|全集/iu.test(name);
}

/**
 * Whether a release name numbers the episode, alone or in a code: "- 50", "[50]", "S17E50". Not
 * when the number is part of another, a checksum ("[50F3DC8F]"), a range ("41-50") or a decimal
 */
export function namesEpisode(name: string, episode: number): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?<!\\d[.-])(?:S\\d{1,3}E|EP?)?${pad(episode)}(?:v\\d)?(?![\\p{L}\\p{N}]|[.-]\\d)`,
    'iu'
  ).test(name);
}

/** The most likely query; the API may also try the plan's other queries. */
export function nyaaQuery(search: NyaaSearch): { category: string; query: string } {
  const { category, query } = nyaaQueryPlan(search);
  return { category, query };
}

/** A nyaa.si, or sukebei.nyaa.si, search for one episode, in nyaa.si's own order (newest first) */
export function nyaaSearchUrl(search: NyaaSearch): string {
  const { category, query } = nyaaQuery(search);
  const url = new URL(`https://${nyaaSite(search.adult ?? false)}/`);
  url.searchParams.set('c', category);
  url.searchParams.set('q', query);
  return url.href;
}

const LANGUAGE_NAMES: Record<DownloadLanguage, string> = {
  any: '',
  english: 'English',
  french: 'French',
};
// A custom search keeps only the category, where French releases sit with every non-English one
const CATEGORY_NAMES: Record<DownloadLanguage, string> = {
  any: '',
  english: 'English',
  french: 'non-English',
};
const VERSION_NAMES: Record<DownloadVersion, string> = {
  any: '',
  subbed: 'subbed',
  dubbed: 'dubbed',
  'dual-audio': 'dual-audio',
};

/**
 * The releases the viewer's settings keep a search to, as in "French dubbed", or '' when it looks
 * for them all. Subbed in any language only leaves dubs out, so raws are still found. A custom
 * search keeps only nyaa.si's category, which sukebei.nyaa.si doesn't have
 */
export function nyaaNarrowing({
  query,
  language = 'any',
  version = 'any',
  adult = false,
}: NyaaSearch): string {
  if (query === undefined)
    return language === 'any' && version === 'subbed'
      ? 'non-dubbed'
      : [LANGUAGE_NAMES[language], VERSION_NAMES[version]].filter(Boolean).join(' ');
  return adult ? '' : CATEGORY_NAMES[language];
}
