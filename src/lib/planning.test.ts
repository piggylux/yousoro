import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  countAnime,
  describePlanned,
  distinctEnglishTitle,
  forgetPlanned,
  getRememberedPlanned,
  groupSeries,
  markStarted,
  pickAnother,
  PLAN_FILTERS,
  type PlannedSeries,
  rememberPlanned,
  formatStartDate,
  sequelFacts,
  seriesGenres,
  seriesSteps,
  sortSeries,
} from '#lib/planning.js';
import type { PlannedAnime, PlannedSequel, Sequel } from '#lib/types/anime.js';
import type { PlanningPageData } from '#lib/types/api.js';

function planned(id: number, changes: Partial<PlannedAnime> = {}): PlannedAnime {
  return {
    id,
    malId: id + 1000,
    title: `Anime ${id}`,
    englishTitle: null,
    coverUrl: null,
    isAdult: false,
    status: 'FINISHED',
    episodes: 12,
    meanScore: null,
    year: 2000 + id,
    genres: [],
    prequels: [],
    sequels: [],
    ...changes,
  };
}

/** Each series by the AniList ids of its parts, in the order to watch them */
const ids = (series: PlannedSeries[]) => series.map(({ parts }) => parts.map(({ id }) => id));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('distinctEnglishTitle', () => {
  it.each([
    ['Sousou no Frieren', "Frieren: Beyond Journey's End", "Frieren: Beyond Journey's End"],
    ['GIRLS BAND CRY', 'Girls Band Cry', null],
    ['Uma Musume: Pretty Derby', 'Umamusume: Pretty Derby', null],
    ["BIRDIE WING: Golf Girls' Story", "BIRDIE WING -Golf Girls' Story-", null],
    ['Mushishi', null, null],
  ])('shows "%s" in English as %s', (title, englishTitle, shown) => {
    expect(distinctEnglishTitle(planned(1, { title, englishTitle }))).toBe(shown);
  });
});

describe('describePlanned', () => {
  it.each([
    [{ status: 'FINISHED', episodes: 12 }, '12 episodes'],
    [{ status: 'FINISHED', episodes: 1 }, '1 episode'],
    [{ status: 'FINISHED', episodes: null }, 'Finished'],
    [{ status: 'RELEASING', episodes: 1100 }, 'Airing · 1,100 episodes'],
    [{ status: 'RELEASING', episodes: null }, 'Airing'],
    [{ status: 'HIATUS' }, 'On hiatus'],
    [{ status: 'CANCELLED' }, 'Cancelled'],
    [{ status: 'NOT_YET_RELEASED', episodes: null }, 'Not aired yet'],
  ] as [Partial<PlannedAnime>, string][])('describes %o as "%s"', (changes, text) => {
    expect(describePlanned(planned(1, changes))).toBe(text);
  });
});

describe('sequelFacts', () => {
  const sequel = (changes: Partial<Sequel> = {}): Sequel => ({
    id: 2,
    malId: 1002,
    title: 'Anime 2',
    englishTitle: null,
    coverUrl: null,
    isAdult: false,
    status: 'FINISHED',
    format: 'TV',
    episodes: 12,
    startDate: { year: 2024, month: 10, day: 5 },
    planned: false,
    ...changes,
  });

  it.each([
    [{}, 'TV · 2024 · 12 episodes'],
    [{ planned: true }, 'TV · 2024 · 12 episodes · On your plan list'],
    [{ status: 'RELEASING', episodes: null, format: 'ONA' }, 'ONA · 2024 · Airing'],
    [{ format: 'MOVIE', episodes: 1 }, 'Movie · 2024'],
    [
      { format: 'TV_SHORT', startDate: { year: null, month: null, day: null } },
      'TV short · 12 episodes',
    ],
    [{ format: null, episodes: null }, '2024 · Finished'],
    [{ status: 'NOT_YET_RELEASED', episodes: null }, 'TV · Starts October 5, 2024'],
    [
      { status: 'NOT_YET_RELEASED', startDate: { year: 2027, month: 4, day: null } },
      'TV · Starts April 2027',
    ],
    [
      { status: 'NOT_YET_RELEASED', startDate: { year: 2027, month: null, day: null } },
      'TV · Starts 2027',
    ],
    [
      {
        status: 'NOT_YET_RELEASED',
        format: 'MOVIE',
        startDate: { year: null, month: null, day: null },
      },
      'Movie · Date not announced',
    ],
  ] as [Partial<Sequel>, string][])('describes %o as "%s"', (changes, text) => {
    expect(sequelFacts(sequel(changes))).toBe(text);
  });
});

describe('formatStartDate', () => {
  it('says the day an anime starts as precisely as AniList knows it', () => {
    const date = { year: 2027, month: 1, day: 8 };
    expect(formatStartDate(date)).toBe('January 8, 2027');
    expect(formatStartDate(date, { short: true, withYear: false })).toBe('Jan 8');
    expect(formatStartDate({ ...date, day: null }, { withYear: false })).toBe('January');
    expect(formatStartDate({ year: 2027, month: null, day: null })).toBeNull();
  });
});

describe('groupSeries', () => {
  it('keeps an anime that continues nothing on the list as a series of its own', () => {
    expect(ids(groupSeries([planned(3), planned(1), planned(2)]))).toEqual([[3], [1], [2]]);
  });

  it('puts each series where its first part is, with the later parts after it', () => {
    // Planned most recently first: the third season, then something else, then the first two
    const list = [
      planned(3, { prequels: [2] }),
      planned(9),
      planned(1),
      planned(2, { prequels: [1] }),
    ];

    expect(ids(groupSeries(list))).toEqual([[9], [1, 2, 3]]);
  });

  it('follows on from every prequel, and otherwise goes in airing order', () => {
    // A movie and a second season both follow the first; a finale follows both
    const list = [
      planned(4, { prequels: [2, 3] }),
      planned(3, { prequels: [1], year: 2003 }),
      planned(2, { prequels: [1], year: 2002 }),
      planned(1),
    ];

    expect(ids(groupSeries(list))).toEqual([[1, 2, 3, 4]]);
  });

  it('joins two first parts that lead to the same sequel', () => {
    const list = [planned(3, { prequels: [1, 2] }), planned(2), planned(1)];

    expect(ids(groupSeries(list))).toEqual([[1, 2, 3]]);
  });

  it('keeps every anime on a MyAnimeList list, which has no ids to join them on', () => {
    const list = [planned(1, { id: null, malId: 1 }), planned(2, { id: null, malId: 2 })];

    expect(groupSeries(list).map(({ parts }) => parts.map(({ malId }) => malId))).toEqual([
      [1],
      [2],
    ]);
  });
});

describe('seriesSteps', () => {
  const sequel = (id: number, changes: Partial<PlannedSequel> = {}): PlannedSequel => ({
    id,
    title: `Anime ${id}`,
    status: 'FINISHED',
    planned: false,
    ...changes,
  });
  /** Each step by its AniList id, a sequel the page doesn't list marked with a star */
  const steps = (list: PlannedAnime[]) =>
    groupSeries(list).map((series) =>
      seriesSteps(series).map(({ kind, anime }) => (kind === 'sequel' ? `${anime.id}*` : anime.id))
    );

  it('says what follows an anime planned on its own', () => {
    const list = [planned(1, { sequels: [sequel(2), sequel(3, { planned: true })] }), planned(9)];

    expect(steps(list)).toEqual([['2*', '3*'], []]);
  });

  it('puts each sequel after the part it continues, among the parts on the list', () => {
    // The first season leads to a movie nobody planned; the second to a third, also not planned
    const list = [
      planned(2, { prequels: [1], sequels: [sequel(30)] }),
      planned(1, { sequels: [sequel(10)] }),
    ];

    expect(steps(list)).toEqual([['10*', 2, '30*']]);
  });

  it('shows a sequel two parts lead to once, after the later of them', () => {
    const list = [
      planned(1, { sequels: [sequel(5)] }),
      planned(2, { prequels: [1], sequels: [sequel(5)] }),
    ];

    expect(steps(list)).toEqual([[2, '5*']]);
  });
});

describe('sortSeries', () => {
  const series = groupSeries([
    planned(1, { title: 'Mushishi', meanScore: 87, episodes: 26 }),
    planned(2, { title: 'Hyouka', meanScore: null, episodes: null }),
    planned(3, { title: 'Aria', meanScore: 82, episodes: 13 }),
    planned(4, { title: 'Monster 2', meanScore: 87, episodes: 1 }),
    planned(5, { title: 'Monster 10', meanScore: 70, episodes: 74, prequels: [4] }),
  ]);

  it('keeps the order they were planned in', () => {
    expect(ids(sortSeries(series, 'planned'))).toEqual([[1], [2], [3], [4, 5]]);
  });

  it('puts the best rated first, by the part to start, and unrated ones last', () => {
    expect(ids(sortSeries(series, 'score'))).toEqual([[1], [4, 5], [3], [2]]);
  });

  it('puts the shortest first, and ones of unknown length last', () => {
    expect(ids(sortSeries(series, 'length'))).toEqual([[4, 5], [3], [1], [2]]);
  });

  it('sorts titles as people read them, numbers by their value', () => {
    expect(ids(sortSeries(series, 'title'))).toEqual([[3], [2], [4, 5], [1]]);
  });
});

describe('PLAN_FILTERS', () => {
  it('finds anime that are airing', () => {
    expect(PLAN_FILTERS.airing.matches(planned(1, { status: 'RELEASING' }))).toBe(true);
    expect(PLAN_FILTERS.airing.matches(planned(1, { status: 'HIATUS' }))).toBe(false);
  });

  it('finds anime of a cour or less, but not ones of unknown length', () => {
    expect(PLAN_FILTERS.short.matches(planned(1, { episodes: 1 }))).toBe(true);
    expect(PLAN_FILTERS.short.matches(planned(1, { episodes: 13 }))).toBe(true);
    expect(PLAN_FILTERS.short.matches(planned(1, { episodes: 24 }))).toBe(false);
    expect(PLAN_FILTERS.short.matches(planned(1, { episodes: null }))).toBe(false);
  });
});

describe('countAnime', () => {
  it('counts every planned anime of the series, not the series', () => {
    const series = groupSeries([planned(1), planned(2, { prequels: [1] }), planned(3)]);

    expect(series).toHaveLength(2);
    expect(countAnime(series)).toBe(3);
  });
});

describe('seriesGenres', () => {
  it('counts the anime each genre shows, by the part each series starts with, A to Z', () => {
    const series = groupSeries([
      planned(1, { genres: ['Drama', 'Action'] }),
      planned(2, { genres: ['Comedy'], prequels: [1] }),
      planned(3, { genres: ['Action'] }),
    ]);

    // Anime 2 continues anime 1, so choosing either genre of anime 1 shows both
    expect(seriesGenres(series)).toEqual([
      { genre: 'Action', count: 3 },
      { genre: 'Drama', count: 2 },
    ]);
  });
});

describe('pickAnother', () => {
  it('picks at random, but not the last pick again while there are others', () => {
    expect(pickAnother(['a', 'b', 'c'], null, () => 0.99)).toBe('c');
    expect(pickAnother(['a', 'b', 'c'], 'a', () => 0)).toBe('b');
    expect(pickAnother(['a'], 'a', () => 0)).toBe('a');
    expect(pickAnother([], null)).toBeNull();
  });
});

describe('remembered plan lists', () => {
  const list = (username: string, ...anime: PlannedAnime[]): PlanningPageData => ({
    domain: 'anilist',
    username,
    canEdit: true,
    planned: anime,
    upcoming: 0,
    userProfileLink: `https://anilist.co/user/${username}/animelist/Planning`,
  });

  it('keeps a list for five minutes, for the same viewer and mature setting only', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const data = list('Fixture', planned(1));
    rememberPlanned('1:', false, 'fixture', data);

    expect(getRememberedPlanned('1:', false, 'anilist', 'FIXTURE')).toBe(data);
    expect(getRememberedPlanned('2:', false, 'anilist', 'fixture')).toBeNull();
    expect(getRememberedPlanned('1:', true, 'anilist', 'fixture')).toBeNull();
    expect(getRememberedPlanned('1:', false, 'myanimelist', 'fixture')).toBeNull();

    vi.mocked(Date.now).mockReturnValue(now + 5 * 60 * 1000);
    expect(getRememberedPlanned('1:', false, 'anilist', 'fixture')).toBeNull();
  });

  it('takes a started anime off that list, whoever remembered it, and no other list', () => {
    rememberPlanned('1:', false, 'Started', list('Started', planned(1), planned(2)));
    rememberPlanned('1:', true, 'Started', list('Started', planned(1), planned(2)));
    rememberPlanned('1:', false, 'Other', list('Other', planned(1)));

    markStarted('anilist', 'started', planned(1));

    for (const showMature of [false, true]) {
      const kept = getRememberedPlanned('1:', showMature, 'anilist', 'Started');
      expect(kept?.planned.map((anime) => anime.id)).toEqual([2]);
    }
    expect(getRememberedPlanned('1:', false, 'anilist', 'Other')?.planned).toHaveLength(1);
  });

  it('forgets a list the user added to elsewhere, whoever remembered it, and no other list', () => {
    rememberPlanned('1:', false, 'Added', list('Added', planned(1)));
    rememberPlanned('1:', true, 'Added', list('Added', planned(1)));
    rememberPlanned('1:', false, 'Other', list('Other', planned(1)));

    forgetPlanned('anilist', 'added');

    expect(getRememberedPlanned('1:', false, 'anilist', 'Added')).toBeNull();
    expect(getRememberedPlanned('1:', true, 'anilist', 'Added')).toBeNull();
    expect(getRememberedPlanned('1:', false, 'anilist', 'Other')).not.toBeNull();
  });

  it('finds a sequel started elsewhere on a MyAnimeList list by its MyAnimeList id', () => {
    const own = (malId: number) => planned(1, { id: null, malId });
    rememberPlanned('1:', false, 'Started', {
      ...list('Started', own(1001), own(1002)),
      domain: 'myanimelist',
    });

    markStarted('myanimelist', 'started', { id: 1, malId: 1001 });

    const kept = getRememberedPlanned('1:', false, 'myanimelist', 'Started');
    expect(kept?.planned.map((anime) => anime.malId)).toEqual([1002]);
  });
});
