import { matchesSearch, searchIndex, searchWords } from '#lib/anime.js';
import { distinctEnglishTitle, groupSeries, type Series } from '#lib/planning.js';
import { retryAfterSeconds } from '#lib/read-retry.js';
import type { AiringStatus, Anime, Sequel } from '#lib/types/anime.js';
import type { ListedIds, OtherList } from '#lib/types/api.js';
import { LIST_NAMES, type Domain } from '#lib/types/domain.js';

/**
 * Finding an anime to add, by asking AniList straight from the browser. Each search counts against
 * the viewer's own AniList allowance rather than the app's, which every list load and save shares.
 * Only public data is asked for, with no sign-in token, as the token never leaves the server
 */
export const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';

/**
 * How many anime one search shows at first, and each time scrolling to the end shows more; the
 * closest matches come first. Enough that the parts of one long series don't crowd out the rest
 */
export const SEARCH_RESULTS = 20;
/**
 * How many pages of results scrolling can show, each a request on the viewer's AniList allowance:
 * 100 anime for a search. A search that hasn't found it by then wants other words
 */
export const MAX_PAGES = 5;
/** Searching starts on its own after a pause in typing, once the search is this long */
export const MIN_AUTO_SEARCH_LENGTH = 3;
/** How long a pause in typing starts a search; pressing Enter searches at once */
export const SEARCH_DELAY_MS = 500;

/**
 * An anime found by a search, in the shape the sequel offer already shows and adds, with what it
 * continues, so the parts of a series can be grouped as on the plan list
 */
export type FoundAnime = Sequel & {
  /** The year it started airing, which orders parts that continue the same one */
  year: number | null;
  /** AniList ids of the anime it continues, by AniList's prequel links */
  prequels: number[];
  /** The title of the first one, to say what it continues when that one wasn't found too */
  continues: string | null;
  /**
   * AniList ids of the anime it's a side story or spin-off of, by AniList's parent links, so it
   * can go with that anime's series
   */
  parents: number[];
  /** The title of the first one, to say whose side story it is */
  sideOf: string | null;
};

export type SearchOutcome =
  /** `more` when AniList has more to show, and scrolling may ask for it */
  | { results: FoundAnime[]; more: boolean }
  | { message: string; /** Seconds until AniList takes searches again */ retryAfter?: number };

/**
 * The search as it's sent: as typed, without spaces around it or doubled inside it. Not folded like
 * the list's own search, as that would turn "ガンダム" into "カンタム"
 */
export function searchText(search: string): string {
  return search.trim().replace(/\s+/g, ' ');
}

// Two kanji or kana often make a whole title, as "銀魂"
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Whether a pause in typing should search: not for a letter or two that would match nearly
 * everything, nor punctuation alone, while two Japanese, Chinese or Korean characters already say
 * a lot. Only letters and numbers count, as they're what a search matches
 */
export function searchesOnPause(search: string): boolean {
  const text = searchWords(search).join(' ');
  // Counted in characters, not UTF-16 units, as some kanji take two
  const length = [...text].length;
  return length >= MIN_AUTO_SEARCH_LENGTH || (length >= 2 && CJK.test(text));
}

/** Whether there's anything to search: Enter searches any word, however short */
export function hasSearch(search: string): boolean {
  return searchWords(search).length > 0;
}

type SearchMedia = {
  id: number;
  idMal: number | null;
  format: string | null;
  status: AiringStatus | null;
  episodes: number | null;
  isAdult: boolean | null;
  title: { romaji: string | null; english: string | null } | null;
  coverImage: { large: string | null } | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  relations: {
    edges: ({
      relationType: string | null;
      node: {
        id: number;
        type: string | null;
        title: { romaji: string | null; english: string | null } | null;
      } | null;
    } | null)[];
  } | null;
};

/** What each anime found is read with, whether by a search or as popular this season */
const FOUND_FIELDS = `
      id
      idMal
      format
      status
      episodes
      isAdult
      title { romaji english }
      coverImage { large }
      startDate { year month day }
      relations { edges { relationType node { id type title { romaji english } } } }`;

const SEARCH_QUERY = `query ($search: String, $page: Int, $perPage: Int, $isAdult: Boolean) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: $isAdult) {${FOUND_FIELDS}
    }
  }
}`;

/** An anime season, as AniList names them */
export type AnimeSeason = { season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'; year: number };
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;

/**
 * The season airing now, as anime seasons go: winter from January, spring from April, summer from
 * July and fall from October, in the viewer's own time
 */
export function currentSeason(now = new Date()): AnimeSeason {
  return { season: SEASONS[Math.floor(now.getMonth() / 3)], year: now.getFullYear() };
}

/** "Fall 2026" */
export function seasonName({ season, year }: AnimeSeason): string {
  return `${season[0]}${season.slice(1).toLowerCase()} ${year}`;
}

/** How many of the season's most popular anime the empty search shows, and shows more of */
export const SEASON_RESULTS = 10;

// Series and their online releases, the ones that air through a season, rather than its films
const SEASON_QUERY = `query (
  $season: MediaSeason
  $year: Int
  $page: Int
  $perPage: Int
  $isAdult: Boolean
) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(
      season: $season
      seasonYear: $year
      type: ANIME
      format_in: [TV, TV_SHORT, ONA]
      sort: POPULARITY_DESC
      isAdult: $isAdult
    ) {${FOUND_FIELDS}
    }
  }
}`;

/** The request for a season's most popular anime, adult ones only when the viewer shows them */
export function seasonRequestBody(season: AnimeSeason, showMature: boolean, page = 1): string {
  return JSON.stringify({
    query: SEASON_QUERY,
    variables: {
      ...season,
      page,
      perPage: SEASON_RESULTS,
      ...(showMature ? {} : { isAdult: false }),
    },
  });
}

/**
 * The request for a page of a search, the first by default. Adult anime are only searched when the
 * viewer's setting shows them; AniList otherwise returns both
 */
export function searchRequestBody(search: string, showMature: boolean, page = 1): string {
  return JSON.stringify({
    query: SEARCH_QUERY,
    variables: {
      search: searchText(search),
      page,
      perPage: SEARCH_RESULTS,
      ...(showMature ? {} : { isAdult: false }),
    },
  });
}

/** The anime in AniList's answer to a search, in its order; one without a title can't be shown */
export function parseSearchResults(body: unknown): FoundAnime[] {
  const media = (body as { data?: { Page?: { media?: (SearchMedia | null)[] } } } | null)?.data
    ?.Page?.media;
  if (!Array.isArray(media)) return [];
  return media.flatMap((node) => {
    const title = node?.title?.romaji ?? node?.title?.english;
    if (!node || !Number.isSafeInteger(node.id) || !title) return [];
    // Anime only, not the manga it adapts. Alternative versions, recaps and anime that only share
    // characters are other stories, so they're not followed
    const related = (type: string) =>
      (node.relations?.edges ?? []).flatMap((edge) =>
        edge?.relationType === type && edge.node?.type === 'ANIME' ? [edge.node] : []
      );
    const prequels = related('PREQUEL');
    const parents = related('PARENT');
    const titleOf = (anime?: { title: SearchMedia['title'] }) =>
      anime?.title?.romaji ?? anime?.title?.english ?? null;
    return [
      {
        id: node.id,
        malId: node.idMal ?? null,
        title,
        englishTitle: node.title?.english ?? null,
        coverUrl: node.coverImage?.large ?? null,
        isAdult: node.isAdult ?? false,
        // Without a status, it's most likely out already, as on the plan list
        status: node.status ?? 'FINISHED',
        format: node.format,
        episodes: node.episodes,
        startDate: {
          year: node.startDate?.year ?? null,
          month: node.startDate?.month ?? null,
          day: node.startDate?.day ?? null,
        },
        planned: false,
        year: node.startDate?.year ?? null,
        prequels: [...new Set(prequels.map((prequel) => prequel.id))],
        continues: titleOf(prequels[0]),
        parents: [...new Set(parents.map((parent) => parent.id))],
        sideOf: titleOf(parents[0]),
      },
    ];
  });
}

/**
 * A series in the results: its main story, in the order to watch it, and the side stories and
 * spin-offs found with it
 */
export type SearchBlock = Series<FoundAnime> & {
  /**
   * Side stories and spin-offs of the series, each run of them in its own order, the run that
   * started airing first first
   */
  sides: FoundAnime[];
  /** Whether a side story matched the search better than the main story did */
  sidesFirst: boolean;
};

/**
 * The results as series, each the closest match's first: the parts of one series together, in the
 * order to watch them, as the plan list orders them. A run of side stories joins the series of the
 * anime it's a side story of, when that was found. Only anime that were found are linked, so a
 * series missing a middle part shows as two
 */
export function searchSeries(results: FoundAnime[]): SearchBlock[] {
  const rank = new Map(results.map((anime, index) => [anime.id, index]));
  const best = (parts: FoundAnime[]) => Math.min(...parts.map(({ id }) => rank.get(id)!));
  const chains = groupSeries(results);
  const chainOf = new Map(chains.flatMap(({ parts }, index) => parts.map(({ id }) => [id, index])));

  // The chain each one is a side story of: the first one found that a part of it names as a parent
  const parentOf = chains.map(({ parts }, index) => {
    for (const { parents } of parts) {
      for (const parent of parents) {
        const other = chainOf.get(parent);
        if (other !== undefined && other !== index) return other;
      }
    }
    return null;
  });
  // A side story of a side story goes with the main story. Were links to loop, it stays on its own
  const mainOf = (index: number) => {
    const seen = new Set([index]);
    for (let at = parentOf[index]; at !== null; at = parentOf[at]) {
      if (seen.has(at)) return index;
      seen.add(at);
      if (parentOf[at] === null) return at;
    }
    return index;
  };

  const blocks = new Map<number, Series<FoundAnime>[]>();
  chains.forEach((chain, index) => {
    const main = mainOf(index);
    if (main !== index) blocks.set(main, [...(blocks.get(main) ?? []), chain]);
    else if (!blocks.has(main)) blocks.set(main, []);
  });
  const firstAired = ({ parts }: Series<FoundAnime>) => parts[0].year ?? Infinity;
  return [...blocks]
    .map(([main, sideChains]) => {
      const { parts } = chains[main];
      const sides = sideChains
        .sort((a, b) => firstAired(a) - firstAired(b) || best(a.parts) - best(b.parts))
        .flatMap((chain) => chain.parts);
      return { parts, sides, sidesFirst: sides.length > 0 && best(sides) < best(parts) };
    })
    .sort((a, b) => best([...a.parts, ...a.sides]) - best([...b.parts, ...b.sides]));
}

/**
 * Whose side story each anime in a list is, for those that say: every side story in a series'
 * side stories, and a main part only when what it's a side story of wasn't found. One that would
 * say the same as the one before it doesn't, as a run of side stories usually shares its parent
 */
export function sideNotes(
  list: FoundAnime[],
  found: ReadonlySet<number>,
  sides: boolean
): (string | null)[] {
  let previous: string | null = null;
  return list.map((anime) => {
    const note =
      anime.sideOf && (sides || !anime.parents.some((id) => found.has(id))) ? anime.sideOf : null;
    const shown = note === previous ? null : note;
    previous = note;
    return shown;
  });
}

/**
 * What an anime continues, when none of the anime it continues was found too, so it's clear it
 * isn't where its story starts: null for one that starts a story, or follows a part shown with it
 */
export function continuesUnseen(anime: FoundAnime, found: ReadonlySet<number>): string | null {
  return anime.prequels.some((id) => found.has(id)) ? null : anime.continues;
}

/** What the search shows of an anime on the Watching list; an unknown episode count is 0 */
export type WatchedAnime = Pick<Anime, 'currentEpisode' | 'numberEpisodes' | 'rewatching'>;

/** Which of the viewer's other lists each anime is on, by the id `ListedIds` keys it by */
export function listedLookup(ids: ListedIds): ReadonlyMap<number, OtherList> {
  return new Map(
    Object.entries(ids).flatMap(([list, onList]) =>
      (onList ?? []).map((id) => [id, list as OtherList] as const)
    )
  );
}

/**
 * Where a found anime is for the viewer, as far as the page knows without asking: on their
 * Watching list, with where they are; on one of their other lists; not addable to a MyAnimeList
 * list, as MyAnimeList doesn't have it; or new to them, as far as is known. Until the other lists
 * are known, an anime on one looks new, until adding it finds out
 */
export type FoundState =
  | { kind: 'watching'; anime: WatchedAnime }
  | { kind: 'listed'; list: OtherList }
  | { kind: 'unavailable' }
  | { kind: 'new' };

export function foundState(
  anime: FoundAnime,
  {
    domain,
    watching,
    listed,
  }: {
    domain: Domain;
    /** The Watching list, by AniList id */
    watching: ReadonlyMap<number, WatchedAnime>;
    /** The other lists, by AniList id on an AniList list and MyAnimeList id on a MyAnimeList one */
    listed: ReadonlyMap<number, OtherList> | null;
  }
): FoundState {
  const watched = watching.get(anime.id);
  if (watched) return { kind: 'watching', anime: watched };
  if (domain === 'myanimelist' && anime.malId === null) return { kind: 'unavailable' };
  const key = domain === 'anilist' ? anime.id : anime.malId;
  const list = key === null ? undefined : listed?.get(key);
  return list ? { kind: 'listed', list } : { kind: 'new' };
}

/** Where an anime is on one of the viewer's other lists: "On your Completed list" */
export function describeListed(list: OtherList, domain: Domain): string {
  return list === 'PLANNING' ? 'On your plan list' : `On your ${LIST_NAMES[domain][list]} list`;
}

/** Where the viewer is in an anime on their Watching list: "Watching · episode 5 of 12" */
export function describeWatching({
  currentEpisode,
  numberEpisodes,
  rewatching,
}: WatchedAnime): string {
  const where = currentEpisode
    ? `episode ${currentEpisode}${numberEpisodes ? ` of ${numberEpisodes}` : ''}`
    : 'not started';
  return `${rewatching ? 'Rewatching' : 'Watching'} · ${where}`;
}

/**
 * The title to show first, and the other one under it when it says more: the English title when
 * the search matched it and not the romaji one, as when searching "Beyond Journey's End"
 */
export function titlesFor(
  anime: Pick<FoundAnime, 'title' | 'englishTitle'>,
  search: string
): { title: string; other: string | null } {
  const english = distinctEnglishTitle(anime);
  const words = searchWords(search);
  const matches = (title: string) =>
    matchesSearch(searchIndex({ title, englishTitle: null }), words);
  if (english && words.length && matches(english) && !matches(anime.title)) {
    return { title: english, other: anime.title };
  }
  return { title: anime.title, other: english };
}

// A title's words as compared: without the punctuation that ends them, as "Darou ka:" or "Gintama."
const bareWord = (word: string) => word.replace(/[^\p{L}\p{N}]+$/u, '').toLowerCase();

/**
 * A later part's title without the series' title it starts with, under that series: "2nd Season"
 * for "Sousou no Frieren 2nd Season". The whole title when it doesn't start with the series' title,
 * or would leave nothing, as "Gintama'" after "Gintama"
 */
export function shortTitle(title: string, series: string): string {
  const words = title.split(' ');
  const prefix = series.split(' ').map(bareWord);
  if (words.length <= prefix.length) return title;
  if (!prefix.every((word, index) => bareWord(words[index]) === word)) return title;
  // What's left starts after the series' title and any punctuation between them, as ": " or " - "
  const rest = words
    .slice(prefix.length)
    .join(' ')
    .replace(/^[^\p{L}\p{N}●○★☆]+/u, '');
  return /[\p{L}\p{N}]/u.test(rest) ? rest : title;
}

// Characters about as wide as two Latin letters, which a title's length counts twice
const WIDE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const widthOf = (char: string) => (WIDE.test(char) ? 2 : 1);
// Where a title can be cut cleanly, and what an ellipsis needn't sit next to
const BREAK = /[\s、。，．・～]/u;
const EDGE_END = /[\s,:;、。，．・～\-–—]+$/u;
const EDGE_START = /^[\s,:;、。，．・～\-–—]+/u;

/**
 * How long a title shows before its middle gives way to an ellipsis, when the room it has isn't
 * known, as the search fits each one to the width of its line
 */
export const TITLE_LENGTH = 72;

/**
 * A title cut in its middle when it's longer than `length`, counted in Latin letters, the
 * Japanese, Chinese and Korean ones twice: its start and its end, which tell the parts of a series
 * apart, around an ellipsis, between words where it has any. Shorter titles are left whole
 */
export function middleEllipsis(text: string, length = TITLE_LENGTH): string {
  const chars = [...text];
  if (chars.reduce((total, char) => total + widthOf(char), 0) <= length) return text;
  // Spaced between words, as long as the ellipsis takes
  const between = text.includes(' ') ? ' … ' : '…';
  const room = length - between.length;
  // As many characters as fit in `units`, from the start or from the end
  const fit = (from: string[], units: number) => {
    let used = 0;
    const kept: string[] = [];
    for (const char of from) {
      used += widthOf(char);
      if (used > units) break;
      kept.push(char);
    }
    return kept;
  };
  let head = fit(chars, Math.ceil(room * 0.6));
  let tail = fit([...chars].reverse(), Math.floor(room * 0.4)).reverse();
  // Between words, or after Japanese and Chinese punctuation, rather than in the middle of a word,
  // when that doesn't lose more than half of either side
  const isBreak = (char?: string) => char !== undefined && BREAK.test(char);
  const headBreak = head.findLastIndex(isBreak);
  if (!isBreak(chars[head.length]) && headBreak >= head.length / 2) {
    head = head.slice(0, headBreak);
  }
  const tailBreak = tail.findIndex(isBreak);
  if (!isBreak(chars[chars.length - tail.length - 1]) && tailBreak !== -1) {
    if (tailBreak <= tail.length / 2) tail = tail.slice(tailBreak + 1);
  }
  const start = head.join('').replace(EDGE_END, '');
  const end = tail.join('').replace(EDGE_START, '');
  return `${start}${between}${end}`;
}

/**
 * A title in pieces, the pieces that hold a word of the search marked, to highlight what matched.
 * Letters compare as the search does, without case or accents; a lone letter isn't marked, as it
 * would be all over the title
 */
export function highlightMatches(text: string, search: string): { text: string; match: boolean }[] {
  const words = searchWords(search).filter((word) => [...word].length > 1);
  const chars = [...text];
  // Each character as the search compares it, and where it starts in the whole compared text
  const folded = chars.map((char) => {
    const bare = char
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    return /^[\p{L}\p{N}]+$/u.test(bare) ? bare : ' ';
  });
  const starts: number[] = [];
  let compared = '';
  for (const piece of folded) {
    starts.push(compared.length);
    compared += piece;
  }
  const marked = chars.map(() => false);
  for (const word of words) {
    for (let at = compared.indexOf(word); at !== -1; at = compared.indexOf(word, at + 1)) {
      chars.forEach((_, index) => {
        const end = starts[index] + folded[index].length;
        if (starts[index] < at + word.length && end > at) marked[index] = true;
      });
    }
  }
  const pieces: { text: string; match: boolean }[] = [];
  chars.forEach((char, index) => {
    const last = pieces.at(-1);
    if (last && last.match === marked[index]) last.text += char;
    else pieces.push({ text: char, match: marked[index] });
  });
  return pieces;
}

/*
 * The last few searches that found something, kept in this browser alone to search again from the
 * empty search. Browser storage can be missing or refuse, in which case there are none
 */
const RECENT_KEY = 'yousoro:anime-searches';
const MAX_RECENT = 5;

export function recentSearches(storage: Pick<Storage, 'getItem'> | null = browserStorage()) {
  try {
    const saved = JSON.parse(storage?.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(saved)
      ? saved.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

/** Puts a search first among the recent ones, once; returns them */
export function rememberSearch(
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage()
): string[] {
  const text = searchText(search);
  const recent = [
    text,
    ...recentSearches(storage).filter((item) => item.toLowerCase() !== text.toLowerCase()),
  ].slice(0, MAX_RECENT);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Kept for this visit only
  }
  return recent;
}

export function forgetRecentSearches(
  storage: Pick<Storage, 'removeItem'> | null = browserStorage()
) {
  try {
    storage?.removeItem(RECENT_KEY);
  } catch {
    // Nothing was kept
  }
}

/** Whether search results leave out anime on the viewer's lists, remembered in this browser */
const HIDE_LISTED_KEY = 'yousoro:anime-search-hide-listed';

export function hidesListed(storage: Pick<Storage, 'getItem'> | null = browserStorage()): boolean {
  try {
    return storage?.getItem(HIDE_LISTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberHidesListed(
  hide: boolean,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = browserStorage()
) {
  try {
    if (hide) storage?.setItem(HIDE_LISTED_KEY, '1');
    else storage?.removeItem(HIDE_LISTED_KEY);
  } catch {
    // Kept for this visit only
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * When AniList takes searches again after saying there were too many: it names the time in
 * `X-RateLimit-Reset`, in seconds since 1970, which browsers can read, unlike `Retry-After`
 */
export function searchRetryAfter(headers: Headers, now = Date.now()): number {
  const reset = Number(headers.get('X-RateLimit-Reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(1, Math.ceil(reset - now / 1000));
  return retryAfterSeconds(headers.get('Retry-After'), now);
}

// Searching the same words again in one visit, as when going back to a result, asks nothing
const MAX_REMEMBERED = 50;
const remembered = new Map<string, { results: FoundAnime[]; more: boolean }>();

type AskOptions = {
  showMature: boolean;
  /** The page to show, from 1; each next one is what scrolling to the end shows */
  page?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
};

/**
 * Searches AniList for anime by title, in any of its titles and synonyms, closest matches first.
 * Never throws: what went wrong comes back as a message for the viewer, except for an aborted
 * search, which nobody waits for any more
 */
export function searchAnime(search: string, options: AskOptions): Promise<SearchOutcome> {
  const { showMature, page = 1 } = options;
  const key = `${showMature ? 'all' : 'safe'}:${page}:${searchText(search).toLowerCase()}`;
  return askAniList(key, searchRequestBody(search, showMature, page), options);
}

/**
 * A season's most popular anime, for the empty search, asked once a visit: the viewer is most
 * often looking for something airing now. Never throws, as a search doesn't
 */
export function seasonAnime(season: AnimeSeason, options: AskOptions): Promise<SearchOutcome> {
  const { showMature, page = 1 } = options;
  const key = `${showMature ? 'all' : 'safe'}:${page}:season:${season.season}:${season.year}`;
  return askAniList(key, seasonRequestBody(season, showMature, page), options);
}

/** Asks AniList for anime, from the browser, unless the same was asked earlier in this visit */
async function askAniList(
  key: string,
  body: string,
  { page = 1, signal, fetch: send = fetch }: AskOptions
): Promise<SearchOutcome> {
  const known = remembered.get(key);
  if (known) return known;
  let response: Response;
  try {
    response = await send(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    return { message: "AniList didn't answer. Check your connection and try again." };
  }
  if (response.status === 429) {
    const retryAfter = searchRetryAfter(response.headers);
    return {
      message: `AniList has had a lot of searches from you. Try again in ${retryAfter} seconds.`,
      retryAfter,
    };
  }
  const answer = await response.json().catch(() => null);
  // An answer with errors may still carry data, but not all of it, so it's neither shown nor kept
  if (!response.ok || answer?.errors?.length || !Array.isArray(answer?.data?.Page?.media)) {
    return { message: "AniList couldn't search right now. Please try again." };
  }
  const outcome = {
    results: parseSearchResults(answer),
    // Past the last page scrolling may show, there's no more, whatever AniList has
    more: answer.data.Page.pageInfo?.hasNextPage === true && page < MAX_PAGES,
  };
  if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!);
  remembered.set(key, outcome);
  return outcome;
}

/**
 * The anime of a further page that aren't shown already: AniList's pages can shift between
 * requests, so one can repeat an anime from the page before
 */
export function newResults(shown: FoundAnime[], page: FoundAnime[]): FoundAnime[] {
  const ids = new Set(shown.map(({ id }) => id));
  return page.filter(({ id }) => !ids.has(id));
}

/** Forgets earlier searches; for tests */
export function forgetSearches() {
  remembered.clear();
}
