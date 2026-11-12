import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ANILIST_GRAPHQL_URL,
  continuesUnseen,
  currentSeason,
  defaultSeason,
  describeListed,
  describeWatching,
  forgetSearches,
  forgetRecentSearches,
  foundState,
  hidesListed,
  LINEUP_PAGES,
  LINEUP_RECOMMENDATIONS,
  lineupRequestBody,
  MAX_PAGES,
  middleEllipsis,
  newResults,
  nextSeason,
  highlightMatches,
  hasSearch,
  listedLookup,
  parseLineup,
  parseSearchResults,
  parseSeasonSlug,
  plainSynopsis,
  recentSearches,
  rememberHidesListed,
  rememberSearch,
  searchAnime,
  searchesOnPause,
  searchRequestBody,
  searchRetryAfter,
  searchSeries,
  sideNotes,
  searchText,
  seasonAnime,
  seasonLineup,
  seasonName,
  seasonRequestBody,
  seasonSlug,
  seasonTiming,
  shortTitle,
  TITLE_LENGTH,
  titlesFor,
} from '#lib/anime-search.js';
import type { ListedIds } from '#lib/types/api.js';

const frieren = {
  id: 154587,
  idMal: 52991,
  format: 'TV',
  status: 'FINISHED',
  episodes: 28,
  isAdult: false,
  title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End" },
  coverImage: { large: 'https://s4.anilist.co/frieren.jpg' },
  startDate: { year: 2023, month: 9, day: 29 },
};

const answer = (media: unknown[]) => Response.json({ data: { Page: { media } } });

beforeEach(() => forgetSearches());

describe('what a search sends', () => {
  it('sends the words as typed, without doubled or surrounding spaces', () => {
    expect(searchText('  Sousou   no Frieren ')).toBe('Sousou no Frieren');
    // Folding would drop the dakuten and search for something else
    expect(searchText('ガンダム')).toBe('ガンダム');
  });

  it('leaves adult anime out unless the viewer shows them', () => {
    expect(JSON.parse(searchRequestBody('frieren', false)).variables).toEqual({
      search: 'frieren',
      page: 1,
      perPage: 20,
      isAdult: false,
    });
    expect(JSON.parse(searchRequestBody('frieren', true)).variables).not.toHaveProperty('isAdult');
  });
});

describe('when a search starts', () => {
  it.each([
    ['', false],
    ['fr', false],
    ['fri', true],
    ['  f r ', true],
    ['銀魂', true],
    ['銀', false],
  ])('a pause after %j searches: %s', (text, expected) => {
    expect(searchesOnPause(text)).toBe(expected);
  });

  it('lets Enter search a single short word, but not punctuation alone', () => {
    expect(hasSearch('K')).toBe(true);
    expect(hasSearch(' !? ')).toBe(false);
  });
});

describe('reading the results', () => {
  it('keeps both ids, both titles and what the sequel offer shows', () => {
    expect(parseSearchResults({ data: { Page: { media: [frieren] } } })).toEqual([
      {
        id: 154587,
        malId: 52991,
        title: 'Sousou no Frieren',
        englishTitle: "Frieren: Beyond Journey's End",
        coverUrl: 'https://s4.anilist.co/frieren.jpg',
        isAdult: false,
        status: 'FINISHED',
        format: 'TV',
        episodes: 28,
        startDate: { year: 2023, month: 9, day: 29 },
        planned: false,
        year: 2023,
        prequels: [],
        continues: null,
        parents: [],
        sideOf: null,
      },
    ]);
  });

  it('fills in what AniList leaves out, and skips anime without a title', () => {
    const results = parseSearchResults({
      data: {
        Page: {
          media: [
            { id: 1, title: { romaji: null, english: 'Only English' } },
            { id: 2, title: null },
            null,
          ],
        },
      },
    });
    expect(results).toEqual([
      expect.objectContaining({
        id: 1,
        malId: null,
        title: 'Only English',
        coverUrl: null,
        isAdult: false,
        status: 'FINISHED',
        startDate: { year: null, month: null, day: null },
      }),
    ]);
  });

  it('reads an unexpected answer as no results', () => {
    expect(parseSearchResults(null)).toEqual([]);
    expect(parseSearchResults({ data: { Page: null } })).toEqual([]);
  });
});

describe('searching AniList', () => {
  it('asks AniList directly, without cookies, and remembers the answer for the same words', async () => {
    const send = vi.fn(async () => answer([frieren]));

    const first = await searchAnime('Frieren', { showMature: false, fetch: send });
    const again = await searchAnime(' frieren ', { showMature: false, fetch: send });

    expect(first).toEqual({ results: [expect.objectContaining({ id: 154587 })], more: false });
    expect(again).toEqual(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      ANILIST_GRAPHQL_URL,
      expect.objectContaining({ method: 'POST', credentials: 'omit' })
    );
  });

  it('searches again when the adult setting differs', async () => {
    const send = vi.fn(async () => answer([frieren]));

    await searchAnime('frieren', { showMature: false, fetch: send });
    await searchAnime('frieren', { showMature: true, fetch: send });

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('says when to try again once AniList has had too many searches', async () => {
    const now = Date.now();
    vi.useFakeTimers({ now });
    const reset = String(Math.floor(now / 1000) + 42);
    const send = vi.fn(
      async () => new Response(null, { status: 429, headers: { 'X-RateLimit-Reset': reset } })
    );

    const outcome = await searchAnime('frieren', { showMature: false, fetch: send });
    vi.useRealTimers();

    expect(outcome).toMatchObject({ retryAfter: expect.any(Number) });
    expect('retryAfter' in outcome && outcome.retryAfter).toBeGreaterThanOrEqual(42);
    expect('retryAfter' in outcome && outcome.retryAfter).toBeLessThanOrEqual(43);
  });

  it("doesn't remember a failed search", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ errors: [{ message: 'oops' }] }, { status: 500 }))
      .mockResolvedValueOnce(answer([frieren]));

    expect(await searchAnime('frieren', { showMature: false, fetch: send })).toEqual({
      message: "AniList couldn't search right now. Please try again.",
    });
    expect(await searchAnime('frieren', { showMature: false, fetch: send })).toMatchObject({
      results: [expect.objectContaining({ id: 154587 })],
    });
  });

  it('turns a network failure into a message, but lets an aborted search go', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await searchAnime('frieren', { showMature: false, fetch: offline })).toEqual({
      message: "AniList didn't answer. Check your connection and try again.",
    });

    const controller = new AbortController();
    controller.abort();
    const aborted = vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(
      searchAnime('frieren', { showMature: false, fetch: aborted, signal: controller.signal })
    ).rejects.toThrow('Aborted');
  });
});

describe('grouping results into series', () => {
  // As AniList links them: a prequel edge, a side story and the manga it adapts
  const media = (
    id: number,
    year: number,
    prequels: [number, string][] = [],
    others: [string, string][] = [],
    parents: [number, string][] = []
  ) => ({
    id,
    title: { romaji: `Anime ${id}`, english: null },
    startDate: { year, month: null, day: null },
    relations: {
      edges: [
        ...prequels.map(([prequel, title]) => ({
          relationType: 'PREQUEL',
          node: { id: prequel, type: 'ANIME', title: { romaji: title, english: null } },
        })),
        ...parents.map(([parent, title]) => ({
          relationType: 'PARENT',
          node: { id: parent, type: 'ANIME', title: { romaji: title, english: null } },
        })),
        ...others.map(([relationType, type]) => ({
          relationType,
          node: { id: 999, type, title: { romaji: 'Other', english: null } },
        })),
      ],
    },
  });
  const found = (...items: ReturnType<typeof media>[]) =>
    parseSearchResults({ data: { Page: { media: items } } });
  const ids = (series: ReturnType<typeof searchSeries>) =>
    series.map(({ parts }) => parts.map(({ id }) => id));

  it('keeps only the anime each one continues', () => {
    const [anime] = found(
      media(
        2,
        2026,
        [[1, 'Season 1']],
        [
          ['SIDE_STORY', 'ANIME'],
          ['PREQUEL', 'MANGA'],
        ]
      )
    );
    expect(anime).toMatchObject({ prequels: [1], continues: 'Season 1', year: 2026 });
  });

  it('puts the parts of a series together in watch order, led by the closest match', () => {
    // AniList found season 3 first, then season 2, a stand-alone special, and season 1
    const results = found(
      media(3, 2027, [[2, 'Season 2']]),
      media(10, 2023),
      media(2, 2026, [[1, 'Season 1']]),
      media(1, 2023)
    );
    expect(ids(searchSeries(results))).toEqual([[1, 2, 3], [10]]);
  });

  it('places a film between the seasons it links, as the plan list does', () => {
    const results = found(
      media(4, 2015, [
        [2, 'Season 2'],
        [3, 'Film'],
      ]),
      media(3, 2013, [[2, 'Season 2']]),
      media(2, 2012, [[1, 'Season 1']]),
      media(1, 2006)
    );
    expect(ids(searchSeries(results))).toEqual([[1, 2, 3, 4]]);
  });

  it('says what a part continues only when that part was not found', () => {
    const results = found(
      media(5, 2021, [[4, 'The Semi-Final']]),
      media(2, 2026, [[1, 'S1']]),
      media(1, 2023)
    );
    const shown = new Set(results.map(({ id }) => id));
    const [final, second] = results;

    expect(ids(searchSeries(results))).toEqual([[5], [1, 2]]);
    expect(continuesUnseen(final, shown)).toBe('The Semi-Final');
    expect(continuesUnseen(second, shown)).toBeNull();
  });

  describe('side stories', () => {
    // As Frieren's: three seasons, and three shorts that are side stories of the first two
    const seasons = [
      media(1, 2023),
      media(2, 2026, [[1, 'S1']]),
      media(3, 2027, [[2, 'S2']]),
    ] as const;
    const shorts = [
      media(10, 2023, [], [], [[1, 'S1']]),
      media(11, 2025, [[10, 'Short 1']], [], [[1, 'S1']]),
      media(12, 2026, [[11, 'Short 2']], [], [[2, 'S2']]),
    ] as const;
    const sides = (blocks: ReturnType<typeof searchSeries>) =>
      blocks.map((block) => block.sides.map(({ id }) => id));

    it('keeps whose side story an anime is', () => {
      expect(found(shorts[2])[0]).toMatchObject({ parents: [2], sideOf: 'S2' });
      expect(found(seasons[0])[0]).toMatchObject({ parents: [], sideOf: null });
    });

    it('go with their main series, in their own order, after it', () => {
      const blocks = searchSeries(found(...seasons, shorts[2], shorts[0], shorts[1]));

      expect(ids(blocks)).toEqual([[1, 2, 3]]);
      expect(sides(blocks)).toEqual([[10, 11, 12]]);
      expect(blocks[0].sidesFirst).toBe(false);
    });

    it('open first when one of them matched the search better than the main story', () => {
      const blocks = searchSeries(found(shorts[0], ...seasons));

      expect(blocks).toEqual([expect.objectContaining({ sidesFirst: true })]);
    });

    it('go with the main story through a side story of a side story', () => {
      const blocks = searchSeries(
        found(seasons[0], shorts[0], media(20, 2024, [], [], [[10, 'Short 1']]))
      );

      expect(ids(blocks)).toEqual([[1]]);
      expect(sides(blocks)).toEqual([[10, 20]]);
    });

    it('stand on their own, saying whose they are, when the main story was not found', () => {
      const results = found(...shorts);
      const blocks = searchSeries(results);
      const shown = new Set(results.map(({ id }) => id));

      expect(ids(blocks)).toEqual([[10, 11, 12]]);
      expect(sideNotes(blocks[0].parts, shown, false)).toEqual(['S1', null, 'S2']);
    });

    it("say whose they are in a series' side stories, unless the one before says the same", () => {
      const results = found(...seasons, ...shorts);
      const [block] = searchSeries(results);
      const shown = new Set(results.map(({ id }) => id));

      expect(sideNotes(block.sides, shown, true)).toEqual(['S1', null, 'S2']);
      expect(sideNotes(block.parts, shown, false)).toEqual([null, null, null]);
    });

    it('stay apart when their links loop', () => {
      const blocks = searchSeries(
        found(media(30, 2020, [], [], [[31, 'B']]), media(31, 2021, [], [], [[30, 'A']]))
      );

      expect(ids(blocks)).toEqual([[30], [31]]);
    });
  });
});

describe('what the search says of an anime already on your list', () => {
  const [anime] = parseSearchResults({ data: { Page: { media: [frieren] } } });
  const watched = { currentEpisode: 5, numberEpisodes: 28, rewatching: false };
  const state = (
    domain: 'anilist' | 'myanimelist',
    lists: { watching?: [number, typeof watched][]; listed?: ListedIds | null },
    found = anime
  ) =>
    foundState(found, {
      domain,
      watching: new Map(lists.watching ?? []),
      listed: lists.listed === null ? null : listedLookup(lists.listed ?? {}),
    });

  it('shows where you are in one you watch, before anything else', () => {
    expect(
      state('anilist', { watching: [[154587, watched]], listed: { PLANNING: [154587] } })
    ).toEqual({ kind: 'watching', anime: watched });
  });

  it('knows its list by its AniList id, or its MyAnimeList id on a MyAnimeList list', () => {
    expect(state('anilist', { listed: { PLANNING: [154587] } })).toEqual({
      kind: 'listed',
      list: 'PLANNING',
    });
    expect(state('anilist', { listed: { COMPLETED: [52991] } })).toEqual({ kind: 'new' });
    expect(state('myanimelist', { listed: { COMPLETED: [1], PAUSED: [52991] } })).toEqual({
      kind: 'listed',
      list: 'PAUSED',
    });
  });

  it("treats one as new while the other lists aren't known yet", () => {
    expect(state('myanimelist', { listed: null })).toEqual({ kind: 'new' });
  });

  it.each([
    ['PLANNING', 'anilist', 'On your plan list'],
    ['PLANNING', 'myanimelist', 'On your plan list'],
    ['COMPLETED', 'anilist', 'On your Completed list'],
    ['PAUSED', 'anilist', 'On your Paused list'],
    ['PAUSED', 'myanimelist', 'On your On-Hold list'],
    ['DROPPED', 'myanimelist', 'On your Dropped list'],
  ] as const)('says %s on %s as %j', (list, domain, text) => {
    expect(describeListed(list, domain)).toBe(text);
  });

  it("can't add one MyAnimeList doesn't have to a MyAnimeList list", () => {
    expect(state('myanimelist', {}, { ...anime, malId: null })).toEqual({ kind: 'unavailable' });
    expect(state('anilist', {}, { ...anime, malId: null })).toEqual({ kind: 'new' });
  });

  it.each([
    [{ currentEpisode: 5, numberEpisodes: 28, rewatching: false }, 'Watching · episode 5 of 28'],
    [{ currentEpisode: 3, numberEpisodes: 0, rewatching: true }, 'Rewatching · episode 3'],
    [{ currentEpisode: 0, numberEpisodes: 12, rewatching: false }, 'Watching · not started'],
  ])('describes %o as %j', (entry, text) => {
    expect(describeWatching(entry)).toBe(text);
  });
});

describe('reading when AniList takes searches again', () => {
  it('prefers the reset time, then Retry-After, then a minute', () => {
    const now = 1_700_000_000_000;
    expect(searchRetryAfter(new Headers({ 'X-RateLimit-Reset': '1700000030' }), now)).toBe(30);
    expect(searchRetryAfter(new Headers({ 'Retry-After': '12' }), now)).toBe(12);
    expect(searchRetryAfter(new Headers(), now)).toBe(60);
  });
});

describe('how a found anime reads', () => {
  const frierenTitles = {
    title: 'Sousou no Frieren',
    englishTitle: "Frieren: Beyond Journey's End",
  };

  it('shows the English title first when that is what the search matched', () => {
    expect(titlesFor(frierenTitles, 'beyond journey')).toEqual({
      title: "Frieren: Beyond Journey's End",
      other: 'Sousou no Frieren',
    });
    expect(titlesFor(frierenTitles, 'frieren')).toEqual({
      title: 'Sousou no Frieren',
      other: "Frieren: Beyond Journey's End",
    });
    expect(titlesFor({ title: 'Gintama', englishTitle: 'GINTAMA' }, 'gintama')).toEqual({
      title: 'Gintama',
      other: null,
    });
  });

  it.each([
    ['Sousou no Frieren 2nd Season', 'Sousou no Frieren', '2nd Season'],
    ['Sousou no Frieren: ●● no Mahou', 'Sousou no Frieren', '●● no Mahou'],
    [
      'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka IV: Shin Shou',
      'Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka',
      'IV: Shin Shou',
    ],
    ['Gintama.: Shirogane no Tamashii-hen', 'Gintama', 'Shirogane no Tamashii-hen'],
    // Nothing would be left, or it doesn't start with the series' title
    ["Gintama'", 'Gintama', "Gintama'"],
    ['Sousou no Frieren', 'Sousou no Frieren', 'Sousou no Frieren'],
    ['Fate/Zero', 'Fate/stay night', 'Fate/Zero'],
  ])('shortens %j under %j to %j', (title, series, short) => {
    expect(shortTitle(title, series)).toBe(short);
  });

  it('marks the words of the search in a title, ignoring case and accents', () => {
    expect(highlightMatches('Pokémon: Mezase Pokémon Master', 'pokemon master')).toEqual([
      { text: 'Pokémon', match: true },
      { text: ': Mezase ', match: false },
      { text: 'Pokémon', match: true },
      { text: ' ', match: false },
      { text: 'Master', match: true },
    ]);
    // A lone letter would mark the title all over
    expect(highlightMatches('Kaguya-sama', 'k')).toEqual([{ text: 'Kaguya-sama', match: false }]);
    expect(highlightMatches('機動戦士ガンダム', 'ガンダム')).toEqual([
      { text: '機動戦士', match: false },
      { text: 'ガンダム', match: true },
    ]);
  });
});

describe('what the search keeps in this browser', () => {
  const storage = () => {
    const items = new Map<string, string>();
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
  };

  it('keeps the last five searches, the latest first, each once', () => {
    const kept = storage();
    for (const search of ['a1', 'b2', 'c3', 'd4', 'e5', ' A1 ', 'f6']) rememberSearch(search, kept);

    expect(recentSearches(kept)).toEqual(['f6', 'A1', 'e5', 'd4', 'c3']);
    forgetRecentSearches(kept);
    expect(recentSearches(kept)).toEqual([]);
  });

  it('remembers whether to hide what is on your lists', () => {
    const kept = storage();
    expect(hidesListed(kept)).toBe(false);
    rememberHidesListed(true, kept);
    expect(hidesListed(kept)).toBe(true);
    rememberHidesListed(false, kept);
    expect(hidesListed(kept)).toBe(false);
  });

  it('does without storage that is missing, refuses, or holds something unexpected', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(recentSearches(null)).toEqual([]);
    expect(recentSearches(refusing)).toEqual([]);
    expect(rememberSearch('frieren', refusing)).toEqual(['frieren']);
    expect(hidesListed(refusing)).toBe(false);
    expect(() => rememberHidesListed(true, refusing)).not.toThrow();
    expect(recentSearches({ getItem: () => '{"not":"a list"}' })).toEqual([]);
  });
});

describe("this season's popular anime", () => {
  it.each([
    [new Date(2026, 0, 5), { season: 'WINTER', year: 2026 }, 'Winter 2026'],
    [new Date(2026, 3, 1), { season: 'SPRING', year: 2026 }, 'Spring 2026'],
    [new Date(2026, 8, 30), { season: 'SUMMER', year: 2026 }, 'Summer 2026'],
    [new Date(2026, 10, 9), { season: 'FALL', year: 2026 }, 'Fall 2026'],
    [new Date(2026, 11, 31), { season: 'FALL', year: 2026 }, 'Fall 2026'],
  ] as const)('on %s, the season airing is %o', (now, season, name) => {
    expect(currentSeason(now)).toEqual(season);
    expect(seasonName(season)).toBe(name);
  });

  it("asks for the season's series by popularity, adult ones only when shown", () => {
    const fall = { season: 'FALL', year: 2026 } as const;
    const { query, variables } = JSON.parse(seasonRequestBody(fall, false));

    expect(variables).toEqual({
      season: 'FALL',
      year: 2026,
      page: 1,
      perPage: 10,
      isAdult: false,
    });
    expect(query).toContain('sort: POPULARITY_DESC');
    expect(query).toContain('format_in: [TV, TV_SHORT, ONA]');
    expect(JSON.parse(seasonRequestBody(fall, true)).variables).not.toHaveProperty('isAdult');
  });

  it('asks once a visit, apart from searches', async () => {
    const send = vi.fn(async () => answer([frieren]));
    const fall = { season: 'FALL', year: 2026 } as const;

    await seasonAnime(fall, { showMature: false, fetch: send });
    await seasonAnime(fall, { showMature: false, fetch: send });
    // A search for the same words as the remembered season is its own
    await searchAnime('fall', { showMature: false, fetch: send });

    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('answers and searches that find nothing to show', () => {
  it("doesn't search on a pause for punctuation alone", () => {
    expect(searchesOnPause('!!!')).toBe(false);
    expect(searchesOnPause('...')).toBe(false);
    expect(searchesOnPause('re:zero')).toBe(true);
  });

  it('neither shows nor keeps an answer that came with errors', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: { Page: null }, errors: [{ message: 'Internal error' }] })
      )
      .mockResolvedValueOnce(answer([frieren]));

    expect(await searchAnime('frieren', { showMature: false, fetch: send })).toEqual({
      message: "AniList couldn't search right now. Please try again.",
    });
    expect(await searchAnime('frieren', { showMature: false, fetch: send })).toMatchObject({
      results: [expect.objectContaining({ id: 154587 })],
    });
  });
});

describe('more results, a page at a time', () => {
  const page = (media: unknown[], hasNextPage: boolean) =>
    Response.json({ data: { Page: { pageInfo: { hasNextPage }, media } } });
  const anime = (id: number) => ({
    ...frieren,
    id,
    title: { romaji: `Anime ${id}`, english: null },
  });

  it('asks for the page shown next, and says when AniList has more', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(page([anime(1)], true))
      .mockResolvedValueOnce(page([anime(2)], false));

    expect(await searchAnime('fate', { showMature: false, fetch: send })).toMatchObject({
      more: true,
    });
    expect(await searchAnime('fate', { showMature: false, page: 2, fetch: send })).toMatchObject({
      results: [expect.objectContaining({ id: 2 })],
      more: false,
    });
    const asked = send.mock.calls.map(([, init]) => JSON.parse(init.body).variables.page);
    expect(asked).toEqual([1, 2]);
  });

  it('remembers each page apart, so going back to one asks nothing', async () => {
    const send = vi.fn(async () => page([anime(1)], true));

    await searchAnime('fate', { showMature: false, page: 2, fetch: send });
    await searchAnime('fate', { showMature: false, page: 2, fetch: send });
    await searchAnime('fate', { showMature: false, page: 3, fetch: send });

    expect(send).toHaveBeenCalledTimes(2);
  });

  it(`stops at page ${MAX_PAGES}, whatever AniList has`, async () => {
    const send = vi.fn(async () => page([anime(1)], true));

    expect(
      await searchAnime('fate', { showMature: false, page: MAX_PAGES, fetch: send })
    ).toMatchObject({ more: false });
    expect(
      await seasonAnime({ season: 'FALL', year: 2026 }, { showMature: false, page: 2, fetch: send })
    ).toMatchObject({ more: true });
  });

  it('leaves out what an earlier page showed, as pages can shift', () => {
    const shown = parseSearchResults({ data: { Page: { media: [anime(1), anime(2)] } } });
    const next = parseSearchResults({ data: { Page: { media: [anime(2), anime(3)] } } });

    expect(newResults(shown, next).map(({ id }) => id)).toEqual([3]);
  });
});

describe('huge titles, cut in the middle', () => {
  const tsuihou =
    'Tsuihou Sareta Cheat Fuyo Majutsushi wa Kimama na Second Life wo Ouka Suru.: Ore wa Buki dake ja Naku, Arayuru Mono ni "Kyouka Point" wo Fuyo Dekiru shi, Ore no Ishi de Itsudemo Kouka wo Kaijo Dekiru kedo, Nokotta Hitotachi Daijoubu?';

  it('leaves a title that fits whole', () => {
    const jojo = 'JoJo no Kimyou na Bouken: Steel Ball Run - 2nd & 3rd STAGE';
    expect(middleEllipsis(jojo)).toBe(jojo);
  });

  it('keeps its start and its end, cut between words', () => {
    expect(middleEllipsis(tsuihou)).toBe(
      'Tsuihou Sareta Cheat Fuyo Majutsushi wa … Nokotta Hitotachi Daijoubu?'
    );
    expect([...middleEllipsis(tsuihou)].length).toBeLessThanOrEqual(TITLE_LENGTH);
  });

  it('counts Japanese, Chinese and Korean characters twice, and cuts at their punctuation', () => {
    const japanese =
      '追放された付与魔術師は気ままにセカンドライフを謳歌する。～俺は武器だけじゃなく、あらゆるものに『強化ポイント』を付与できるし、俺の意思でいつでも効果を解除できるけど、残った人たちは大丈夫？～';
    const short = middleEllipsis(japanese);

    expect(short).toMatch(/^追放された.+…残った人たちは大丈夫？～$/u);
    expect([...short].length).toBeLessThanOrEqual(TITLE_LENGTH / 2);
  });

  it.each([12, 20, 30, 45, 72])(
    'never comes out longer than the %d letters asked for',
    (length) => {
      expect([...middleEllipsis(tsuihou, length)].length).toBeLessThanOrEqual(length);
    }
  );
});

describe('huge titles on a narrow line', () => {
  it("cuts between words rather than in one, as a phone's short line would", () => {
    const short = middleEllipsis(
      'Tsuihou Sareta S-kyuu Kanteishi ga Saikyou Guild wo Tsukuru Musou Suru',
      26
    );

    expect(short).toMatch(/^Tsuihou Sareta … \S/);
    expect(short).not.toMatch(/… usou/);
    expect(short.endsWith('Suru')).toBe(true);
  });
});

describe('the seasons the season page shows', () => {
  it.each([
    [
      { season: 'WINTER', year: 2026 },
      { season: 'SPRING', year: 2026 },
    ],
    [
      { season: 'SUMMER', year: 2026 },
      { season: 'FALL', year: 2026 },
    ],
    [
      { season: 'FALL', year: 2026 },
      { season: 'WINTER', year: 2027 },
    ],
  ] as const)('after %o comes %o', (season, next) => {
    expect(nextSeason(season)).toEqual(next);
  });

  it.each([
    [new Date(2026, 9, 1), { season: 'FALL', year: 2026 }],
    [new Date(2026, 10, 30), { season: 'FALL', year: 2026 }],
    // In a season's last month, the next one is announced and worth planning for
    [new Date(2026, 11, 1), { season: 'WINTER', year: 2027 }],
    [new Date(2027, 0, 1), { season: 'WINTER', year: 2027 }],
    [new Date(2027, 2, 15), { season: 'SPRING', year: 2027 }],
  ] as const)('on %s, it opens on %o', (now, season) => {
    expect(defaultSeason(now)).toEqual(season);
  });

  it('says whether a season has aired, is airing, or is to come', () => {
    const now = new Date(2026, 10, 12);
    expect(seasonTiming({ season: 'SUMMER', year: 2026 }, now)).toBe('past');
    expect(seasonTiming({ season: 'FALL', year: 2026 }, now)).toBe('airing');
    expect(seasonTiming({ season: 'WINTER', year: 2027 }, now)).toBe('upcoming');
    expect(seasonTiming({ season: 'FALL', year: 2025 }, now)).toBe('past');
  });

  it('names a season in a page address and reads it back', () => {
    const now = new Date(2026, 10, 12);
    const winter = { season: 'WINTER', year: 2027 } as const;
    expect(seasonSlug(winter)).toBe('winter-2027');
    expect(parseSeasonSlug('winter-2027', now)).toEqual(winter);
    expect(parseSeasonSlug('fall-1940', now)).toEqual({ season: 'FALL', year: 1940 });
  });

  it.each(['Winter-2027', 'autumn-2026', 'fall-26', 'fall-1939', 'fall-2029', 'fall-2026-x', ''])(
    "doesn't take %o for a season",
    (slug) => {
      expect(parseSeasonSlug(slug, new Date(2026, 10, 12))).toBeNull();
    }
  );
});

describe("a season's whole lineup", () => {
  const fall = { season: 'FALL', year: 2026 } as const;
  const lineupAnime = (id: number, overrides: Record<string, unknown> = {}) => ({
    ...frieren,
    id,
    title: { romaji: `Anime ${id}`, english: null },
    genres: ['Adventure', null],
    tags: [
      {
        name: 'Found Family',
        rank: 85,
        isAdult: false,
        isMediaSpoiler: false,
        isGeneralSpoiler: false,
      },
      { name: 'Tragedy', rank: 70, isAdult: false, isMediaSpoiler: true, isGeneralSpoiler: false },
      { name: 'Nudity', rank: 60, isAdult: true, isMediaSpoiler: false, isGeneralSpoiler: false },
    ],
    studios: { nodes: [{ name: 'Madhouse' }, { name: 'Madhouse' }, null] },
    averageScore: 88,
    popularity: 4200,
    description: 'An elf mage&#039;s journey.<br><br>After the <i>hero</i> dies&hellip;',
    relations: {
      edges: [
        {
          relationType: 'PREQUEL',
          node: { id: 9, idMal: 1009, type: 'ANIME', title: { romaji: 'Season 1', english: null } },
        },
        {
          relationType: 'PARENT',
          node: { id: 8, idMal: null, type: 'ANIME', title: { romaji: null, english: 'Main' } },
        },
        {
          relationType: 'PREQUEL',
          node: { id: 7, idMal: 7, type: 'MANGA', title: { romaji: 'The manga', english: null } },
        },
      ],
    },
    recommendations: {
      nodes: [
        {
          rating: 120,
          mediaRecommendation: { id: 20, idMal: 2020, title: { romaji: 'Mushishi' } },
        },
        { rating: 3, mediaRecommendation: { id: 21, idMal: null, title: { romaji: 'Odd' } } },
        // More disagreed with than agreed, as many as either, without a title, or gone from AniList
        { rating: -2, mediaRecommendation: { id: 22, idMal: 22, title: { romaji: 'Disputed' } } },
        { rating: 0, mediaRecommendation: { id: 23, idMal: 23, title: { romaji: 'Even' } } },
        { rating: 4, mediaRecommendation: { id: 24, idMal: 24, title: { romaji: null } } },
        { rating: 5, mediaRecommendation: null },
        null,
      ],
    },
    ...overrides,
  });
  const page = (media: unknown[], hasNextPage: boolean) =>
    Response.json({ data: { Page: { pageInfo: { hasNextPage }, media } } });

  it('asks for 50 series of the season at a time, by popularity, adult ones only when shown', () => {
    const { query, variables } = JSON.parse(lineupRequestBody(fall, false, 2));

    expect(variables).toEqual({ season: 'FALL', year: 2026, page: 2, perPage: 50, isAdult: false });
    expect(query).toContain('sort: POPULARITY_DESC');
    expect(query).toContain('format_in: [TV, TV_SHORT, ONA]');
    expect(query).toContain('node { id idMal type');
    expect(query).toContain(
      `recommendations(perPage: ${LINEUP_RECOMMENDATIONS}, sort: RATING_DESC)`
    );
    expect(JSON.parse(lineupRequestBody(fall, true)).variables).not.toHaveProperty('isAdult');
    // Searches don't pay for what ranking a season needs
    expect(JSON.parse(searchRequestBody('frieren', false)).query).not.toContain('genres');
  });

  it('reads what ranking and describing an anime need, without spoilers or adult tags', () => {
    const [anime] = parseLineup({ data: { Page: { media: [lineupAnime(1), null] } } });

    expect(anime).toMatchObject({
      id: 1,
      genres: ['Adventure'],
      tags: [{ name: 'Found Family', rank: 85 }],
      studios: ['Madhouse'],
      averageScore: 88,
      popularity: 4200,
      synopsis: "An elf mage's journey.\n\nAfter the hero dies…",
      prequels: [9],
      prequelLinks: [{ id: 9, malId: 1009, title: 'Season 1' }],
      parentLinks: [{ id: 8, malId: null, title: 'Main' }],
      recommendations: [
        { id: 20, malId: 2020, title: 'Mushishi', rating: 120 },
        { id: 21, malId: null, title: 'Odd', rating: 3 },
      ],
    });
  });

  it('reads a description as plain text', () => {
    expect(plainSynopsis('A&amp;B <b>bold</b><br />next &#x2014; end &bogus;')).toBe(
      'A&B bold\nnext — end &bogus;'
    );
    expect(plainSynopsis('<br><br>')).toBeNull();
    expect(plainSynopsis(null)).toBeNull();
  });

  it('reads page after page until AniList has no more, then asks nothing again', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(page([lineupAnime(1), lineupAnime(2)], true))
      // Pages can shift between requests, so an anime can show twice
      .mockResolvedValueOnce(page([lineupAnime(2), lineupAnime(3)], false));

    const outcome = await seasonLineup(fall, { showMature: false, fetch: send });
    expect(outcome).toMatchObject({ results: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    await seasonLineup(fall, { showMature: false, fetch: send });

    expect(send).toHaveBeenCalledTimes(2);
  });

  it(`stops after ${LINEUP_PAGES} pages, whatever AniList has`, async () => {
    let id = 0;
    const send = vi.fn(async () => page([lineupAnime(++id)], true));

    await seasonLineup(fall, { showMature: false, fetch: send });

    expect(send).toHaveBeenCalledTimes(LINEUP_PAGES);
  });

  it("keeps apart from the search's popular anime of the same season", async () => {
    const send = vi.fn(async () => page([lineupAnime(1)], false));

    await seasonAnime(fall, { showMature: false, fetch: send });
    const outcome = await seasonLineup(fall, { showMature: false, fetch: send });

    expect(send).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ results: [{ id: 1, genres: ['Adventure'] }] });
  });

  it('says to wait when AniList is busy, and only asks for the pages it missed when tried again', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(page([lineupAnime(1)], true))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }))
      .mockResolvedValueOnce(page([lineupAnime(2)], false));

    expect(await seasonLineup(fall, { showMature: false, fetch: send })).toEqual({
      message: 'AniList has had a lot of requests from you. Try again in 30 seconds.',
      retryAfter: 30,
    });
    expect(await seasonLineup(fall, { showMature: false, fetch: send })).toMatchObject({
      results: [{ id: 1 }, { id: 2 }],
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('says AniList failed when it answers with errors', async () => {
    const send = vi.fn(async () => Response.json({ data: null, errors: [{ message: 'x' }] }));

    expect(await seasonLineup(fall, { showMature: false, fetch: send })).toEqual({
      message: "AniList couldn't list the season right now. Please try again.",
    });
  });
});
