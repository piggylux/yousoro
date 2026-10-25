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

const TERMS: Record<DownloadLanguage, Record<DownloadVersion, string>> = {
  any: {
    any: '',
    subbed: '-dub -dubbed -vf',
    dubbed: '(dub|dubbed|(dual audio)|vf|multi)',
    'dual-audio': '((dual audio)|multi)',
  },
  english: {
    any: '',
    subbed: '-dub -dubbed',
    dubbed: '(dub|dubbed|(dual audio))',
    'dual-audio': '(dual audio)',
  },
  french: {
    any: '(vostfr|vf|vff|french|multi)',
    subbed: 'vostfr',
    dubbed: '(vf|vff|multi) -vostfr',
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
// The search stops growing at this many characters of phrases, as they're sent in the link, where
// quotes, "|" and accented letters take several characters each: much longer, and nyaa.si can take
// too long to answer
const MAX_ENCODED_CHARS = 600;

const encodedLength = (text: string) => new URLSearchParams([['q', text]]).toString().length - 2;

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
 * part in another script, and without quotes, which would end the phrase early
 */
function cleanTitle(title: string) {
  return title
    .normalize('NFC')
    .replace(NON_LATIN_BRACKETS, '')
    .replace(/["\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const withoutPunctuation = (title: string) => title.replace(/['’`:;,.!?()[\]{}]/g, '');

/*
 * Every phrase that could name the episode is ranked by how likely release names are to use it,
 * and the search keeps the most likely ones that fit in MAX_ENCODED_CHARS. The main titles are the
 * romaji and the English one; an anime can have many other titles, as Pokémon Horizons has one
 * per arc, and those come last
 */
const enum Rank {
  /**
   * A main title as written, with the episode number: "Title - 05", "Title 05", and with its
   * season as "S3", as SubsPlease, one of the most common groups, names seasons: "Title S3 - 05"
   */
  Number,
  /** The same with an episode code: "Title - S02E05", "Title S02E05" */
  Code,
  /** A main title in brackets after another title: "Pokémon Horizons (Pocket Monsters 2023) - 152" */
  Bracketed,
  /** A main title without punctuation, which release names often drop: "My Girlfriends Friend" */
  Unpunctuated,
  /** The other ways of writing a season ("Season 2", "2nd Season"), and guessed seasons */
  Season,
  /** Another title, with the episode number */
  Other,
}

/**
 * The exact phrases that name one episode, most likely first, as many as fit in the budget. Each
 * ends with the episode number or code, with or without a dash, as release names write it
 */
function episodePhrases(titles: { main: string[]; other: string[] }, episode: number): string[] {
  /*
   * By lowercase phrase, so each phrase is kept once, at its best rank. Within a rank, the forms
   * with a dash come before the ones without, for every title in turn, so a long title can't use
   * up the budget before the other title gets its most likely form
   */
  const candidates = new Map<
    string,
    { phrase: string; rank: Rank; dashless: boolean; order: number }
  >();
  const add = (rank: Rank, phrase: string, dashless = false) => {
    const key = phrase.toLowerCase();
    const known = candidates.get(key);
    if (known && known.rank <= rank) return;
    candidates.set(key, { phrase, rank, dashless, order: known?.order ?? candidates.size });
  };
  const withNumber = (rank: Rank, name: string) => {
    add(rank, `"${name} - ${pad(episode)}"`);
    add(rank, `"${name} ${pad(episode)}"`, true);
  };
  const withCode = (rank: Rank, name: string, season: number) => {
    const code = `S${pad(season)}E${pad(episode)}`;
    add(rank, `"${name} - ${code}"`);
    add(rank, `"${name} ${code}"`, true);
  };

  for (const title of titles.main.map(cleanTitle)) {
    for (const [spelling, asWritten] of [
      [title, true],
      [cleanTitle(withoutPunctuation(title)), false],
    ] as const) {
      if (!spelling || !LATIN_TITLE.test(spelling)) continue;

      withNumber(asWritten ? Rank.Number : Rank.Unpunctuated, spelling);
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
  for (const title of titles.other.map(cleanTitle)) {
    for (const spelling of [title, cleanTitle(withoutPunctuation(title))]) {
      if (spelling && LATIN_TITLE.test(spelling)) withNumber(Rank.Other, spelling);
    }
  }

  const ranked = [...candidates.values()].sort(
    (a, b) => a.rank - b.rank || Number(a.dashless) - Number(b.dashless) || a.order - b.order
  );
  const kept: string[] = [];
  let length = 0;
  for (const { phrase } of ranked) {
    // Counting the "|" between phrases. A phrase too long for what's left is skipped, so shorter
    // ones after it still get in; the most likely phrase is always kept
    const cost = encodedLength(phrase) + encodedLength('|');
    if (kept.length > 0 && length + cost > MAX_ENCODED_CHARS) continue;
    kept.push(phrase);
    length += cost;
  }
  return kept;
}

export type NyaaSearch = {
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
};

/**
 * The nyaa.si category and query for one episode. Each spelling of the title is an exact phrase
 * that ends with the episode number, laid out the ways release names write it ("Title - 05",
 * "Title 05", "(Title) - 05"), so another season ("Title S2 - 05") or a longer title that starts
 * the same way doesn't match.
 */
export function nyaaQuery({
  title,
  englishTitle,
  otherTitles = [],
  episode,
  language = 'any',
  version = 'any',
  adult = false,
}: NyaaSearch): { category: string; query: string } {
  const main = englishTitle ? [title, englishTitle] : [title];
  const phrases = episodePhrases({ main, other: otherTitles }, episode);
  // When no title can be spelled in a phrase, its words and the episode number still narrow it
  // down. Search operators are taken out of them, or "-Title-" would exclude a word
  const titleQuery = phrases.length
    ? `(${phrases.join('|')})`
    : `${cleanTitle(title)
        .replace(/[|()+~*]/g, ' ')
        .replace(/(^|\s)-+/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()} ${pad(episode)}`;
  const query = [
    titleQuery,
    adult ? SUKEBEI_LANGUAGE_TERMS[language] : '',
    TERMS[language][version],
    '-batch',
  ]
    .filter(Boolean)
    .join(' ');
  return { category: adult ? SUKEBEI_ANIME : CATEGORIES[language], query };
}

/** A nyaa.si, or sukebei.nyaa.si, search for one episode, in nyaa.si's own order (newest first) */
export function nyaaSearchUrl(search: NyaaSearch): string {
  const { category, query } = nyaaQuery(search);
  const url = new URL(`https://${nyaaSite(search.adult ?? false)}/`);
  url.searchParams.set('c', category);
  url.searchParams.set('q', query);
  return url.href;
}
