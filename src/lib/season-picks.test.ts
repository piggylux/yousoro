import { describe, expect, it } from 'vitest';

import type { SeasonAnime } from '#lib/anime-search.js';
import { MIN_SCORED, PICKS, rankSeason, seasonGenres, sortSeason } from '#lib/season-picks.js';
import type { SeasonTaste, TasteTrait } from '#lib/types/season.js';

function anime(id: number, overrides: Partial<SeasonAnime> = {}): SeasonAnime {
  return {
    id,
    malId: id + 1000,
    title: `Anime ${id}`,
    englishTitle: null,
    coverUrl: null,
    isAdult: false,
    status: 'RELEASING',
    format: 'TV',
    episodes: 12,
    startDate: { year: 2026, month: 10, day: 1 },
    planned: false,
    year: 2026,
    prequels: (overrides.prequelLinks ?? []).map(({ id }) => id),
    continues: overrides.prequelLinks?.[0]?.title ?? null,
    parents: (overrides.parentLinks ?? []).map(({ id }) => id),
    sideOf: overrides.parentLinks?.[0]?.title ?? null,
    genres: [],
    tags: [],
    studios: [],
    averageScore: null,
    popularity: 1000,
    synopsis: null,
    prequelLinks: [],
    parentLinks: [],
    ...overrides,
  };
}

function taste(overrides: Partial<SeasonTaste> = {}): SeasonTaste {
  return {
    scored: 50,
    watched: 60,
    traits: [],
    listedIds: {},
    watching: [],
    scores: [],
    mean100: 70,
    ...overrides,
  };
}

const trait = (
  kind: TasteTrait['kind'],
  name: string,
  lift: number | null,
  count = 20
): TasteTrait => ({ kind, name, count, lift });

const ids = (picks: { anime: { id: number } }[]) => picks.map(({ anime }) => anime.id);

describe('ranking a season by taste', () => {
  it('puts anime of genres, themes and studios they score highly first', () => {
    const lineup = [
      anime(1, { genres: ['Comedy'], popularity: 9000 }),
      anime(2, { genres: ['Psychological'], studios: ['MAPPA'], popularity: 1000 }),
      anime(3, { tags: [{ name: 'Found Family', rank: 90 }], popularity: 500 }),
    ];
    const ranked = rankSeason(
      lineup,
      taste({
        traits: [
          trait('genre', 'Comedy', -0.4),
          trait('genre', 'Psychological', 0.6),
          trait('studio', 'MAPPA', 0.5),
          trait('tag', 'Found Family', 0.7),
        ],
      }),
      { domain: 'anilist' }
    );

    expect(ids(ranked.all)).toEqual([2, 3, 1]);
    expect(ranked.byScores).toBe(true);
    expect(ranked.all[0].reasons).toEqual([
      'Psychological, a genre you score highly',
      'From MAPPA, a studio you score highly',
    ]);
    expect(ranked.all[1].reasons[0]).toBe('Found Family, a theme you score highly');
  });

  it('trusts a lift less when few anime have it', () => {
    const lineup = [
      anime(1, { genres: ['Horror'], popularity: 1000 }),
      anime(2, { genres: ['Mystery'], popularity: 1000 }),
    ];
    const ranked = rankSeason(
      lineup,
      taste({ traits: [trait('genre', 'Horror', 0.8, 1), trait('genre', 'Mystery', 0.5, 40)] }),
      { domain: 'anilist' }
    );

    expect(ids(ranked.all)).toEqual([2, 1]);
    // One horror anime is too few to name it as a reason
    expect(ranked.all[1].reasons).toEqual([]);
  });

  it('ignores tags that say little of the anime', () => {
    const lineup = [
      anime(1, { tags: [{ name: 'Isekai', rank: 20 }] }),
      anime(2, { tags: [{ name: 'Isekai', rank: 80 }] }),
    ];
    const ranked = rankSeason(lineup, taste({ traits: [trait('tag', 'Isekai', 0.9)] }), {
      domain: 'anilist',
    });

    expect(ids(ranked.all)).toEqual([2, 1]);
    expect(ranked.all[1].reasons).toEqual([]);
  });

  it('speaks of the list owner by name to someone else', () => {
    const ranked = rankSeason(
      [anime(1, { studios: ['Madhouse'] })],
      taste({ traits: [trait('studio', 'Madhouse', 0.6)] }),
      { domain: 'anilist', voice: { name: 'Alice' } }
    );

    expect(ranked.all[0].reasons[0]).toBe('From Madhouse, a studio Alice scores highly');
  });
});

describe('sequels', () => {
  const frieren = { id: 10, malId: 1010, title: 'Sousou no Frieren' };

  it('puts a new part of something they loved first, under Continuing', () => {
    const lineup = [
      anime(1, { genres: ['Action'], popularity: 50_000 }),
      anime(2, { prequelLinks: [frieren], popularity: 100 }),
    ];
    const ranked = rankSeason(
      lineup,
      taste({ listedIds: { COMPLETED: [10] }, scores: [[10, 95]] }),
      { domain: 'anilist' }
    );

    expect(ids(ranked.all)).toEqual([2, 1]);
    expect(ids(ranked.continuing)).toEqual([2]);
    expect(ranked.continuing[0].reasons[0]).toBe('Continues Sousou no Frieren, which you loved');
    // Continuing anime aren't picked again
    expect(ids(ranked.picks)).toEqual([1]);
  });

  it('says what they did with the earlier part', () => {
    const rank = (overrides: Partial<SeasonTaste>) =>
      rankSeason([anime(2, { prequelLinks: [frieren] })], taste(overrides), {
        domain: 'anilist',
      }).continuing[0]?.reasons[0];

    expect(rank({ listedIds: { COMPLETED: [10] } })).toBe(
      'Continues Sousou no Frieren, which you finished'
    );
    expect(rank({ watching: [{ id: 10, progress: 3, rewatching: false }] })).toBe(
      'Continues Sousou no Frieren, which you are watching'
    );
    expect(rank({ listedIds: { PAUSED: [10] } })).toBe(
      'Continues Sousou no Frieren, which you paused'
    );
  });

  it('lowers one whose earlier part they dropped, and says so', () => {
    const lineup = [anime(1), anime(2, { prequelLinks: [frieren] })];
    const ranked = rankSeason(lineup, taste({ listedIds: { DROPPED: [10] } }), {
      domain: 'anilist',
    });

    expect(ids(ranked.all)).toEqual([1, 2]);
    expect(ranked.all[1].note).toBe('You dropped Sousou no Frieren');
    expect(ranked.continuing).toEqual([]);
    expect(ids(ranked.picks)).toEqual([1]);
  });

  it('says where to start a story they haven’t seen, and leaves it out of the picks', () => {
    const lineup = [anime(1), anime(2, { prequelLinks: [frieren], popularity: 90_000 })];
    const ranked = rankSeason(lineup, taste({ listedIds: { PLANNING: [10] } }), {
      domain: 'anilist',
    });

    expect(ranked.all.find(({ anime }) => anime.id === 2)?.note).toBe(
      'Continues Sousou no Frieren: start there'
    );
    expect(ids(ranked.picks)).toEqual([1]);
  });

  it("only says what a MyAnimeList list's sequel continues when that isn't on MyAnimeList", () => {
    const lineup = [
      anime(1, { popularity: 500 }),
      anime(2, { prequelLinks: [{ ...frieren, malId: null }], popularity: 500 }),
    ];
    const ranked = rankSeason(lineup, taste({ listedIds: { COMPLETED: [1010] } }), {
      domain: 'myanimelist',
    });
    const sequel = ranked.all.find(({ anime }) => anime.id === 2)!;

    expect(sequel.note).toBe('Continues Sousou no Frieren');
    // Not lowered for an earlier part that can't be looked for, nor picked as a place to start
    expect(sequel.fit).toBe(ranked.all.find(({ anime }) => anime.id === 1)!.fit);
    expect(ids(ranked.picks)).toEqual([1]);
  });

  it('matches a MyAnimeList list by MyAnimeList ids', () => {
    const ranked = rankSeason(
      [anime(2, { prequelLinks: [frieren] })],
      taste({ listedIds: { COMPLETED: [1010] } }),
      { domain: 'myanimelist' }
    );

    expect(ids(ranked.continuing)).toEqual([2]);
  });

  it('counts a side story of something watched, without calling it a continuation', () => {
    const ranked = rankSeason(
      [anime(1), anime(2, { parentLinks: [frieren] })],
      taste({ listedIds: { COMPLETED: [10] } }),
      { domain: 'anilist' }
    );

    expect(ids(ranked.all)).toEqual([2, 1]);
    expect(ranked.continuing).toEqual([]);
    expect(ranked.all[0].reasons[0]).toBe('A side story of Sousou no Frieren, which you watched');
  });
});

describe('what the picks leave out', () => {
  it('leaves out anime already on a list, and keeps them in the whole season', () => {
    const lineup = [anime(1), anime(2), anime(3)];
    const ranked = rankSeason(
      lineup,
      taste({
        listedIds: { PLANNING: [1] },
        watching: [{ id: 2, progress: 1, rewatching: false }],
      }),
      { domain: 'anilist' }
    );

    expect(ids(ranked.picks)).toEqual([3]);
    expect(ranked.all).toHaveLength(3);
  });

  it(`picks ${PICKS} at most`, () => {
    const lineup = Array.from({ length: 20 }, (_, index) => anime(index + 1));
    expect(rankSeason(lineup, taste(), { domain: 'anilist' }).picks).toHaveLength(PICKS);
  });
});

describe('without enough of their taste to go by', () => {
  it('goes by popularity and AniList score, and picks nothing', () => {
    const lineup = [
      anime(1, { popularity: 100, genres: ['Drama'] }),
      anime(2, { popularity: 5000 }),
      anime(3, { popularity: 900, averageScore: 88 }),
    ];
    const thin = taste({
      scored: MIN_SCORED - 1,
      watched: 3,
      traits: [trait('genre', 'Drama', 2)],
    });

    for (const ranked of [
      rankSeason(lineup, thin, { domain: 'anilist' }),
      rankSeason(lineup, null, { domain: 'anilist' }),
    ]) {
      expect(ranked.tasteKnown).toBe(false);
      expect(ids(ranked.all)).toEqual([2, 3, 1]);
      expect(ranked.picks).toEqual([]);
      expect(ranked.all[0].reasons).toEqual(["One of the season's most popular"]);
      expect(ranked.all[1].reasons).toEqual(['AniList average 88%']);
    }
  });

  it('goes by what they watch most when they rarely score', () => {
    const lineup = [anime(1, { genres: ['Comedy'] }), anime(2, { genres: ['Sports'] })];
    const ranked = rankSeason(
      lineup,
      taste({
        scored: 0,
        watched: 40,
        mean100: null,
        traits: [trait('genre', 'Sports', null, 30), trait('genre', 'Comedy', null, 2)],
      }),
      { domain: 'anilist' }
    );

    expect(ranked.tasteKnown).toBe(true);
    expect(ranked.byScores).toBe(false);
    expect(ids(ranked.all)).toEqual([2, 1]);
    // Without scores, nothing is said to be scored highly
    expect(ranked.all[0].reasons).not.toContain('Sports, a genre you score highly');
  });
});

describe('the whole season in other orders', () => {
  const lineup = [
    anime(1, { popularity: 300, averageScore: null, startDate: { year: 2026, month: 10, day: 9 } }),
    anime(2, { popularity: 900, averageScore: 70, startDate: { year: 2026, month: 10, day: 2 } }),
    anime(3, {
      popularity: 100,
      averageScore: 85,
      startDate: { year: null, month: null, day: null },
    }),
    anime(4, {
      popularity: 500,
      averageScore: 70,
      startDate: { year: 2026, month: 10, day: null },
    }),
  ];
  const picks = rankSeason(lineup, null, { domain: 'anilist' }).all;

  it.each([
    ['popular', [2, 4, 1, 3]],
    ['score', [3, 2, 4, 1]],
    ['start', [2, 1, 4, 3]],
  ] as const)('sorts by %s', (sort, order) => {
    expect(ids(sortSeason(picks, sort))).toEqual(order);
  });

  it('keeps the fit order as ranked', () => {
    expect(sortSeason(picks, 'fit')).toBe(picks);
  });

  it('counts genres, the most common first', () => {
    expect(
      seasonGenres([
        anime(1, { genres: ['Drama', 'Action'] }),
        anime(2, { genres: ['Action'] }),
        anime(3, { genres: ['Comedy'] }),
      ])
    ).toEqual([
      { genre: 'Action', count: 2 },
      { genre: 'Comedy', count: 1 },
      { genre: 'Drama', count: 1 },
    ]);
  });
});
