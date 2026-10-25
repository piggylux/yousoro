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
// Enough phrases to find a release, without an endless URL; the most likely come first
const MAX_PHRASES = 40;

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
 * The phrases come in tiers, most likely first, so the cap only ever cuts the least likely. The
 * main titles (the romaji and the English one) get all their phrases before the other titles get
 * any: an anime can have many other titles, as Pokémon Horizons has one per arc, and those must
 * not push out a main title's less usual layouts.
 */
const enum Group {
  Main,
  Other,
}
const enum Tier {
  /** A title, as written and without punctuation, with the episode number and code */
  Title,
  /** The other ways of writing its season ("S2", "Season 2", "2nd Season"), and guessed seasons */
  Season,
  /** All of these in brackets after another title */
  Bracketed,
}
const TIERS_PER_GROUP = 3;

/**
 * The exact phrases that name one episode, most likely first. Each title is spelled as written,
 * then without punctuation, which release names often drop ("My Girlfriends Friend", "Title
 * Subtitle" for "Title: Subtitle", "Pocket Monsters 2023" for "Pocket Monsters (2023)"); a
 * season, if any, is also spelled the usual ways ("S2", "Season 2", "2nd Season"). Each spelling
 * is followed by the episode number ("05") and, from the title without its season, by an episode
 * code ("Title S02E05"), laid out the ways release names write them: with or without a dash
 * ("Title - 05", "Title 05"), and in brackets after another title, as in "Pokémon Horizons
 * (Pocket Monsters 2023) - 152".
 */
function episodePhrases(titles: { main: string[]; other: string[] }, episode: number): string[] {
  // Main titles' tiers, then the other titles' tiers
  const tiers = Array.from({ length: 2 * TIERS_PER_GROUP }, () => new Map<string, string>());
  const add = (group: Group, tier: Tier, phrase: string) => {
    const key = phrase.toLowerCase();
    if (tiers.some((phrases) => phrases.has(key))) return;
    tiers[group * TIERS_PER_GROUP + tier].set(key, phrase);
  };
  const addLayouts = (group: Group, tier: Tier, name: string, number: string) => {
    add(group, tier, `"${name} ${number}"`);
    add(group, tier, `"${name} - ${number}"`);
    // A title with brackets of its own is also spelled without them, for this layout
    if (!/[()]/.test(name)) add(group, Tier.Bracketed, `"(${name}) - ${number}"`);
  };
  const code = (season: number) => `S${pad(season)}E${pad(episode)}`;

  const spellings = [
    ...titles.main.map((title) => ({ title, group: Group.Main })),
    ...titles.other.map((title) => ({ title, group: Group.Other })),
  ].flatMap(({ title, group }) => {
    const clean = cleanTitle(title);
    return [clean, cleanTitle(withoutPunctuation(clean))].map((spelling) => ({ spelling, group }));
  });
  for (const { spelling: title, group } of spellings) {
    if (!title || !LATIN_TITLE.test(title)) continue;

    addLayouts(group, Tier.Title, title, pad(episode));
    const season = splitSeason(title);
    if (!season) {
      addLayouts(group, Tier.Title, title, code(1));
      continue;
    }
    const { base, season: number, guessed } = season;
    for (const name of [`${base} S${number}`, `${base} Season ${number}`]) {
      addLayouts(group, Tier.Season, name, pad(episode));
    }
    addLayouts(group, Tier.Season, `${base} ${ordinal(number)} Season`, pad(episode));
    if (guessed) {
      // The number may be part of the name ("Kaiju No. 8"), so the title stays a season 1
      addLayouts(group, Tier.Title, title, code(1));
      addLayouts(group, Tier.Season, base, code(number));
    } else {
      addLayouts(group, Tier.Title, base, code(number));
    }
  }
  return tiers.flatMap((phrases) => [...phrases.values()]).slice(0, MAX_PHRASES);
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

/** A nyaa.si, or sukebei.nyaa.si, search for one episode, with the best-seeded releases first */
export function nyaaSearchUrl(search: NyaaSearch): string {
  const { category, query } = nyaaQuery(search);
  const url = new URL(`https://${nyaaSite(search.adult ?? false)}/`);
  url.searchParams.set('f', '0');
  url.searchParams.set('c', category);
  url.searchParams.set('q', query);
  url.searchParams.set('s', 'seeders');
  url.searchParams.set('o', 'desc');
  return url.href;
}
