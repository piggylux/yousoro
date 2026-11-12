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
    recommendations: [],
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
      anime(1, { genres: ['Comedy'] }),
      anime(2, { genres: ['Psychological'], studios: ['MAPPA'] }),
      anime(3, { tags: [{ name: 'Found Family', rank: 90 }] }),
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
    expect(ranked.byRecommendations).toBe(false);
    expect(ranked.all[0].reasons).toEqual([
      'From MAPPA, a studio you score highly',
      'Psychological, a genre you score highly',
    ]);
    expect(ranked.all[1].reasons[0]).toBe('Found Family, a theme you score highly');
  });

  it('counts a genre, which most anime share, for less than a theme', () => {
    const lineup = [
      anime(1, { genres: ['Drama'] }),
      anime(2, { tags: [{ name: 'Iyashikei', rank: 80 }] }),
      anime(3, { genres: ['Drama'], tags: [{ name: 'Iyashikei', rank: 80 }] }),
    ];
    const ranked = rankSeason(
      lineup,
      taste({ traits: [trait('genre', 'Drama', 0.6), trait('tag', 'Iyashikei', 0.6)] }),
      { domain: 'anilist' }
    );

    expect(ids(ranked.all)).toEqual([3, 2, 1]);
    expect(ranked.all[0].reasons).toEqual([
      'Iyashikei, a theme you score highly',
      'Drama, a genre you score highly',
    ]);
  });

  it("doesn't let one strong trait outrank an anime it knows more of", () => {
    const lineup = [
      anime(1, { studios: ['Shaft'] }),
      anime(2, {
        genres: ['Drama', 'Romance'],
        tags: [
          { name: 'Iyashikei', rank: 80 },
          { name: 'Found Family', rank: 70 },
        ],
        studios: ['P.A. Works'],
      }),
    ];
    const ranked = rankSeason(
      lineup,
      taste({
        traits: [
          trait('studio', 'Shaft', 1.2),
          trait('genre', 'Drama', 0.5),
          trait('genre', 'Romance', 0.5),
          trait('tag', 'Iyashikei', 0.5),
          trait('tag', 'Found Family', 0.5),
          trait('studio', 'P.A. Works', 0.5),
        ],
      }),
      { domain: 'anilist' }
    );

    expect(ids(ranked.all)).toEqual([2, 1]);
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

describe('recommendations by AniList users', () => {
  const mushishi = { id: 50, malId: 1050, title: 'Mushishi', rating: 40 };
  const dropped = { id: 51, malId: 1051, title: 'Dropped Show', rating: 40 };
  const planned = { id: 52, malId: 1052, title: 'Planned Show', rating: 40 };
  // Scored 95, 70 and 45, so 95 is well above their average of 70
  const scored = taste({
    listedIds: { COMPLETED: [50, 60, 61], DROPPED: [51], PLANNING: [52] },
    scores: [
      [50, 95],
      [60, 70],
      [61, 45],
    ],
  });

  it('puts anime recommended to fans of what they loved first, and says which', () => {
    const lineup = [
      anime(1, { popularity: 9000 }),
      anime(2, { popularity: 1000, recommendations: [mushishi] }),
    ];
    const ranked = rankSeason(lineup, scored, { domain: 'anilist' });

    expect(ids(ranked.all)).toEqual([2, 1]);
    expect(ids(ranked.picks)).toEqual([2, 1]);
    expect(ranked.byRecommendations).toBe(true);
    expect(ranked.all[0].reasons[0]).toBe('For fans of Mushishi, which you loved');
  });

  it("doesn't take a point's difference in scores that barely vary for a favourite", () => {
    const fitFor = (scores: SeasonTaste['scores']) =>
      rankSeason(
        [anime(1, { recommendations: [mushishi] })],
        taste({ listedIds: { COMPLETED: scores.map(([id]) => id) }, scores, mean100: 80 }),
        { domain: 'anilist' }
      ).all[0].fit;
    const barelyVary: SeasonTaste['scores'] = [
      [50, 81],
      [60, 80],
      [61, 80],
      [62, 80],
      [63, 80],
    ];
    const spread: SeasonTaste['scores'] = [
      [50, 95],
      [60, 80],
      [61, 65],
    ];

    expect(fitFor(barelyVary)).toBeLessThan(fitFor(spread));
  });

  it('ranks anime recommended to fans of what they dropped below those of what they loved', () => {
    const lineup = [
      anime(1, { recommendations: [dropped] }),
      anime(2, { recommendations: [mushishi] }),
      anime(3, { recommendations: [planned] }),
      anime(4),
    ];
    const ranked = rankSeason(lineup, scored, { domain: 'anilist' });
    const pickOf = (id: number) => ranked.all.find(({ anime }) => anime.id === id)!;

    expect(ids(ranked.all).slice(0, 2)).toEqual([2, 1]);
    // Only anime they've seen and liked are named; planning to watch one is no sign either way
    for (const id of [1, 3]) expect(pickOf(id).reasons).toEqual([]);
    expect(pickOf(3).fit).toBe(pickOf(4).fit);
  });

  it('names what they loved first, else what they finished without liking it less', () => {
    const average = { id: 60, malId: 1060, title: 'Average Show', rating: 90 };
    const disliked = { id: 61, malId: 1061, title: 'Disliked Show', rating: 90 };
    const reasons = (recommendations: SeasonAnime['recommendations']) =>
      rankSeason([anime(1, { recommendations })], scored, { domain: 'anilist' }).all[0].reasons;

    expect(reasons([average, mushishi])[0]).toBe('For fans of Mushishi, which you loved');
    expect(reasons([disliked, average])[0]).toBe('For fans of Average Show, which you finished');
    // Alone in its season, it's the most popular, which is said instead
    expect(reasons([disliked, dropped])).toEqual(["One of the season's most popular"]);
  });

  it('says what they watched when they rarely score, and speaks of the owner by name', () => {
    const rarely = taste({
      scored: 0,
      watched: 40,
      mean100: null,
      listedIds: { COMPLETED: [50] },
      watching: [{ id: 53, progress: 2, rewatching: false }],
    });
    const reasons = (recommendations: SeasonAnime['recommendations']) =>
      rankSeason([anime(1, { recommendations })], rarely, {
        domain: 'anilist',
        voice: { name: 'Alice' },
      }).all[0].reasons;

    expect(reasons([mushishi])[0]).toBe('For fans of Mushishi, which Alice finished');
    expect(reasons([{ ...mushishi, id: 53, title: 'Ongoing' }])[0]).toBe(
      'For fans of Ongoing, which Alice is watching'
    );
  });

  it('matches a MyAnimeList list by MyAnimeList ids', () => {
    const ranked = rankSeason(
      [anime(1, { recommendations: [mushishi, { ...planned, malId: null }] })],
      taste({
        listedIds: { COMPLETED: [1050, 1060, 1061] },
        scores: [
          [1050, 95],
          [1060, 70],
          [1061, 45],
        ],
      }),
      { domain: 'myanimelist' }
    );

    expect(ranked.all[0].reasons[0]).toBe('For fans of Mushishi, which you loved');
  });

  it("leaves a sequel's own earlier part to say what it continues", () => {
    const ranked = rankSeason(
      [
        anime(1, {
          prequelLinks: [{ id: 50, malId: 1050, title: 'Mushishi' }],
          recommendations: [mushishi],
        }),
      ],
      scored,
      { domain: 'anilist' }
    );

    const { reasons } = ranked.continuing[0];
    expect(reasons[0]).toBe('Continues Mushishi, which you loved');
    expect(reasons).not.toContain('For fans of Mushishi, which you loved');
  });

  it('counts an earlier part once, by what it continues, even one they dropped', () => {
    const fitOf = (prequel: typeof mushishi, withRecs: boolean) =>
      rankSeason(
        [anime(100, { prequelLinks: [prequel], recommendations: withRecs ? [prequel] : [] })],
        scored,
        { domain: 'anilist' }
      ).all[0].fit;

    expect(fitOf(mushishi, true)).toBe(fitOf(mushishi, false));
    expect(fitOf(dropped, true)).toBe(fitOf(dropped, false));
  });

  it('calls an anime loved the same way, whether it continues or is recommended for it', () => {
    // Too few scores to rank by, but a score well above the rest still says it was loved
    const few = taste({
      scored: 2,
      watched: 40,
      mean100: 70,
      listedIds: { COMPLETED: [50, 60] },
      scores: [
        [50, 95],
        [60, 45],
      ],
    });
    const ranked = rankSeason(
      [
        anime(1, { prequelLinks: [{ id: 50, malId: 1050, title: 'Mushishi' }] }),
        anime(2, { recommendations: [mushishi] }),
      ],
      few,
      { domain: 'anilist' }
    );

    expect(ranked.continuing[0].reasons[0]).toBe('Continues Mushishi, which you loved');
    expect(ranked.all.find(({ anime }) => anime.id === 2)?.reasons[0]).toBe(
      'For fans of Mushishi, which you loved'
    );
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
