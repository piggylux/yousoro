import { describe, expect, it } from 'vitest';

import {
  aniListTrait,
  fromAniListStatistics,
  fromMalEntries,
  type AniListStatistics,
  type MalTasteEntry,
} from '#lib/server/season-taste.js';

const statistics = (overrides: Partial<AniListStatistics> = {}): AniListStatistics => ({
  count: 4,
  meanScore: 7,
  standardDeviation: 1,
  genres: [],
  tags: [],
  studios: [],
  ...overrides,
});

describe("a taste from AniList's statistics", () => {
  it("measures each trait against the list's own average, whatever the score format", () => {
    const traits = (meanScore: number, standardDeviation: number, scale: number) =>
      fromAniListStatistics(
        statistics({
          meanScore: meanScore * scale,
          standardDeviation: standardDeviation * scale,
          genres: [
            { genre: 'Drama', count: 10, meanScore: 8 * scale },
            { genre: 'Comedy', count: 3, meanScore: 6.5 * scale },
            // Watched but never scored
            { genre: 'Horror', count: 2, meanScore: 0 },
          ],
        }),
        []
      ).traits;

    const outOf10 = traits(7, 0.5, 1);
    expect(outOf10).toEqual([
      { kind: 'genre', name: 'Drama', count: 10, lift: 2 },
      { kind: 'genre', name: 'Comedy', count: 3, lift: -1 },
      { kind: 'genre', name: 'Horror', count: 2, lift: null },
    ]);
    expect(traits(7, 0.5, 10)).toEqual(outOf10);
  });

  it('leaves out adult tags and studios that only produce or license', () => {
    const { traits } = fromAniListStatistics(
      statistics({
        tags: [
          { tag: { name: 'Isekai', isAdult: false }, count: 5, meanScore: 7 },
          { tag: { name: 'Nudity', isAdult: true }, count: 5, meanScore: 9 },
          { tag: null, count: 1, meanScore: 7 },
        ],
        studios: [
          { studio: { name: 'MAPPA', isAnimationStudio: true }, count: 4, meanScore: 8 },
          { studio: { name: 'Aniplex', isAnimationStudio: false }, count: 9, meanScore: 8 },
        ],
      }),
      []
    );

    expect(traits.map(({ kind, name }) => `${kind}:${name}`)).toEqual([
      'tag:Isekai',
      'studio:MAPPA',
    ]);
  });

  it("says nothing of lifts when the scores don't spread", () => {
    const { traits } = fromAniListStatistics(
      statistics({
        meanScore: 7,
        standardDeviation: 0,
        genres: [{ genre: 'Drama', count: 4, meanScore: 7 }],
      }),
      []
    );
    expect(traits[0].lift).toBeNull();
  });

  it('sorts the anime by list, and counts and averages scores out of 100', () => {
    const taste = fromAniListStatistics(statistics(), [
      { id: 1, status: 'CURRENT', progress: 3, score100: 0 },
      { id: 2, status: 'REPEATING', progress: 5, score100: 90 },
      { id: 3, status: 'COMPLETED', progress: 12, score100: 70 },
      { id: 4, status: 'DROPPED', progress: 2, score100: 40 },
      // A planned anime is neither watched nor its score counted
      { id: 5, status: 'PLANNING', progress: 0, score100: 100 },
    ]);

    expect(taste).toMatchObject({
      listedIds: { COMPLETED: [3], DROPPED: [4], PLANNING: [5] },
      watching: [
        { id: 1, progress: 3, rewatching: false },
        { id: 2, progress: 5, rewatching: true },
      ],
      scores: [
        [2, 90],
        [3, 70],
        [4, 40],
      ],
      scored: 3,
      watched: 4,
      mean100: 67,
    });
  });

  it('has no average when nothing is scored', () => {
    expect(
      fromAniListStatistics(statistics(), [
        { id: 1, status: 'COMPLETED', progress: 1, score100: 0 },
      ]).mean100
    ).toBeNull();
  });
});

describe('a taste from a MyAnimeList list', () => {
  it("names MyAnimeList's genres, themes and demographics as AniList does", () => {
    expect(aniListTrait('Action')).toEqual({ kind: 'genre', name: 'Action' });
    expect(aniListTrait('Suspense')).toEqual({ kind: 'genre', name: 'Thriller' });
    expect(aniListTrait('Isekai')).toEqual({ kind: 'tag', name: 'Isekai' });
    expect(aniListTrait('Girls Love')).toEqual({ kind: 'tag', name: 'Yuri' });
    expect(aniListTrait('Shounen')).toEqual({ kind: 'tag', name: 'Shounen' });
    expect(aniListTrait('Hentai')).toBeNull();
  });

  it('works out each trait’s lift from the list itself', () => {
    const entry = (
      id: number,
      score100: number,
      genres: string[],
      studios: string[] = [],
      status = 'COMPLETED'
    ): MalTasteEntry => ({ id, status, progress: 12, score100, genres, studios });
    const taste = fromMalEntries([
      entry(1, 90, ['Drama'], ['Kyoto Animation']),
      entry(2, 90, ['Drama', 'Isekai']),
      entry(3, 50, ['Comedy', 'Isekai']),
      entry(4, 50, ['Comedy']),
      entry(5, 0, ['Horror']),
      // Planned anime say nothing of taste
      entry(6, 0, ['Sports'], [], 'PLANNING'),
    ]);

    // Their scores average 70 and spread by 20
    expect(taste.mean100).toBe(70);
    expect(taste.traits).toEqual(
      expect.arrayContaining([
        { kind: 'genre', name: 'Drama', count: 2, lift: 1 },
        { kind: 'genre', name: 'Comedy', count: 2, lift: -1 },
        { kind: 'tag', name: 'Isekai', count: 2, lift: 0 },
        { kind: 'studio', name: 'Kyoto Animation', count: 1, lift: 1 },
        { kind: 'genre', name: 'Horror', count: 1, lift: null },
      ])
    );
    expect(taste.traits.map(({ name }) => name)).not.toContain('Sports');
    expect(taste).toMatchObject({ scored: 4, watched: 5, listedIds: { PLANNING: [6] } });
  });
});
