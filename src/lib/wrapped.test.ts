import { describe, expect, it, vi } from 'vitest';

import type { AnimeYear, FinishedAnime } from '#lib/types/wrapped.js';
import {
  loadAnimeYear,
  parseWrappedYear,
  summarizeYear,
  wrappedPath,
  wrappedYear,
} from '#lib/wrapped.js';

function finished(id: number, overrides: Partial<FinishedAnime> = {}): FinishedAnime {
  return {
    id,
    title: `Anime ${id}`,
    coverUrl: null,
    isAdult: false,
    meanScore: null,
    score: 0,
    score100: null,
    episodes: 12,
    minutes: 12 * 24,
    month: 1,
    genres: [],
    ...overrides,
  };
}

function year(anime: FinishedAnime[]): AnimeYear {
  return {
    id: 1,
    name: 'Alice',
    avatarUrl: null,
    scoreFormat: 'POINT_10',
    year: 2026,
    finished: anime,
  };
}

const scoredAt = (score100: number) => ({ score: score100 / 10, score100 });

describe('summing up a year in anime', () => {
  it('counts what was finished, its episodes, and the hours they took', () => {
    const summary = summarizeYear(
      year([finished(1, { episodes: 12, minutes: 288 }), finished(2, { episodes: 1, minutes: 90 })])
    );
    expect(summary).toMatchObject({ finished: 2, episodes: 13, hours: 6 });
  });

  it('ranks the genres finished most, three at most', () => {
    const summary = summarizeYear(
      year([
        finished(1, { genres: ['Drama', 'Action'] }),
        finished(2, { genres: ['Action', 'Comedy'] }),
        finished(3, { genres: ['Comedy', 'Action', 'Romance'] }),
      ])
    );
    expect(summary.topGenres).toEqual([
      { genre: 'Action', count: 3 },
      { genre: 'Comedy', count: 2 },
      { genre: 'Drama', count: 1 },
    ]);
  });

  it('picks the favorite by score, then by what AniList users like most', () => {
    const summary = summarizeYear(
      year([
        finished(1, { ...scoredAt(90), meanScore: 70 }),
        finished(2, { ...scoredAt(90), meanScore: 80 }),
        finished(3),
      ])
    );
    expect(summary.favorite?.id).toBe(2);
    expect(summary.favorites.map(({ id }) => id)).toEqual([2, 1]);
  });

  it('finds the score furthest from the average, when it is far enough to be a take', () => {
    const summary = summarizeYear(
      year([
        finished(1, { ...scoredAt(90), meanScore: 80 }),
        finished(2, { ...scoredAt(30), meanScore: 75 }),
        finished(3, { ...scoredAt(95), meanScore: 70 }),
      ])
    );
    expect(summary.hotTake).toMatchObject({ anime: { id: 2 }, meanScore: 75, higher: false });
    expect(
      summarizeYear(year([finished(1, { ...scoredAt(90), meanScore: 80 })])).hotTake
    ).toBeNull();
  });

  it('finds the busiest month and each season’s favorite', () => {
    const summary = summarizeYear(
      year([
        finished(1, { month: 2, ...scoredAt(60) }),
        finished(2, { month: 3, ...scoredAt(80) }),
        finished(3, { month: 3 }),
        finished(4, { month: 11, ...scoredAt(70) }),
        finished(5, { month: null }),
      ])
    );
    expect(summary.busiestMonth).toEqual({ month: 'March', count: 2 });
    expect(
      summary.seasons.map(({ season, count, favorite }) => [season, count, favorite?.id])
    ).toEqual([
      ['Winter', 3, 2],
      ['Spring', 0, undefined],
      ['Summer', 0, undefined],
      ['Fall', 1, 4],
    ]);
  });

  it('counts adult anime but shows them only to those who chose to see them', () => {
    const summary = summarizeYear(year([finished(1, { isAdult: true, ...scoredAt(90) })]));
    expect(summary.finished).toBe(1);
    expect(summary.favorite).toBeNull();
    expect(
      summarizeYear(year([finished(1, { isAdult: true, ...scoredAt(90) })]), { showMature: true })
        .favorite?.id
    ).toBe(1);
  });
});

describe('which year to sum up', () => {
  it('sums up the last year until January is over', () => {
    expect(wrappedYear(new Date(2027, 0, 31))).toBe(2026);
    expect(wrappedYear(new Date(2027, 1, 1))).toBe(2027);
  });

  it('reads only years AniList could have dates for', () => {
    const now = new Date(2026, 9, 29);
    expect(parseWrappedYear('2026', now)).toBe(2026);
    expect(parseWrappedYear('2027', now)).toBeNull();
    expect(parseWrappedYear('1999', now)).toBeNull();
    expect(parseWrappedYear('26', now)).toBeNull();
    expect(parseWrappedYear('2026.0', now)).toBeNull();
  });

  it('reads a new year as soon as it starts anywhere, so browser and server agree', () => {
    const newYearInKiribati = new Date(Date.UTC(2026, 11, 31, 10));
    expect(parseWrappedYear('2027', newYearInKiribati)).toBe(2027);
    expect(parseWrappedYear('2027', new Date(Date.UTC(2026, 11, 31, 9)))).toBeNull();
  });

  it('links to a year', () => {
    expect(wrappedPath('Alice Fan')).toBe('/user/anilist/Alice%20Fan/wrapped');
    expect(wrappedPath('Alice', 2026)).toBe('/user/anilist/Alice/wrapped/2026');
  });
});

describe('reading a year in the browser', () => {
  const answer = (response: Response) => vi.fn().mockResolvedValue(response);

  it('reads the year under the name in lower case', async () => {
    const fetcher = answer(Response.json(year([])));
    expect(await loadAnimeYear('ALICE', 2026, fetcher)).toEqual({
      status: 'ready',
      year: year([]),
    });
    expect(fetcher).toHaveBeenCalledWith('/api/wrapped/alice/2026');
  });

  it('tells a missing list, a busy AniList, and a failure apart', async () => {
    expect(await loadAnimeYear('a', 2026, answer(new Response(null, { status: 404 })))).toEqual({
      status: 'missing',
    });
    const busy = new Response(null, { status: 429, headers: { 'Retry-After': '30' } });
    expect(await loadAnimeYear('a', 2026, answer(busy))).toMatchObject({ status: 'busy' });
    expect(await loadAnimeYear('a', 2026, vi.fn().mockRejectedValue(new TypeError()))).toEqual({
      status: 'failed',
    });
  });
});
