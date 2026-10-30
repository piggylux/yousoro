import { describe, expect, it } from 'vitest';

import { changesFor, planSync, sameEntry, type SyncCandidate, type SyncEntry } from '#lib/sync.js';

function entry(overrides: Partial<SyncEntry> = {}): SyncEntry {
  return {
    status: 'CURRENT',
    progress: 3,
    score100: 80,
    startedAt: '2026-10-01',
    completedAt: null,
    updatedAt: 1_000,
    ...overrides,
  };
}

function candidate(overrides: Partial<SyncCandidate>): SyncCandidate {
  return {
    mediaId: 1,
    malId: 11,
    title: 'Fixture',
    coverUrl: null,
    isAdult: false,
    anilist: entry(),
    myanimelist: entry(),
    ...overrides,
  };
}

describe('sameEntry', () => {
  it('compares scores as MyAnimeList keeps them, so a rounded score is no difference', () => {
    expect(sameEntry(entry({ score100: 85 }), entry({ score100: 90 }))).toBe(true);
    expect(sameEntry(entry({ score100: 3 }), entry({ score100: 10 }))).toBe(true);
    expect(sameEntry(entry({ score100: 70 }), entry({ score100: 80 }))).toBe(false);
  });

  it('tells apart the start and finish dates', () => {
    expect(sameEntry(entry(), entry({ startedAt: '2026-10-02' }))).toBe(false);
    expect(sameEntry(entry(), entry({ completedAt: '2026-10-30' }))).toBe(false);
  });

  it('tells apart the episode count and the status', () => {
    expect(sameEntry(entry({ progress: 3 }), entry({ progress: 4 }))).toBe(false);
    expect(sameEntry(entry({ status: 'REPEATING' }), entry({ status: 'CURRENT' }))).toBe(false);
  });
});

describe('planSync', () => {
  it('leaves out anime both lists agree on', () => {
    expect(planSync([candidate({})])).toEqual([]);
  });

  it('copies from the list changed last', () => {
    const malNewer = candidate({ myanimelist: entry({ progress: 5, updatedAt: 2_000 }) });
    const aniListNewer = candidate({
      mediaId: 2,
      anilist: entry({ progress: 5, updatedAt: 3_000 }),
    });

    expect(planSync([malNewer, aniListNewer]).map((item) => item.to)).toEqual([
      'anilist',
      'myanimelist',
    ]);
  });

  it('doesn’t take episodes back when the list changed last is behind on them', () => {
    // A new score on AniList, still at episode 3, after episode 8 was watched on MyAnimeList
    const rescored = candidate({
      anilist: entry({ score100: 90, updatedAt: 3_000 }),
      myanimelist: entry({ progress: 8, updatedAt: 2_000 }),
    });
    // Rewatching from episode 1 is a change of status, so the newer list still wins
    const rewatch = candidate({
      mediaId: 2,
      anilist: entry({ status: 'REPEATING', progress: 1, updatedAt: 3_000 }),
      myanimelist: entry({ status: 'COMPLETED', progress: 12, updatedAt: 2_000 }),
    });

    expect(planSync([rescored, rewatch]).map((item) => item.to)).toEqual([
      'anilist',
      'myanimelist',
    ]);
  });

  it('adds an anime to the list that doesn’t have it, rather than deleting it', () => {
    const plan = planSync([
      candidate({ myanimelist: null }),
      candidate({ mediaId: 2, anilist: null }),
    ]);

    expect(plan.map((item) => item.to)).toEqual(['myanimelist', 'anilist']);
  });
});

describe('changesFor', () => {
  const item = { ...candidate({}), malId: 11, to: 'myanimelist' as const };

  it('copies the other list’s entry as it is', () => {
    const changes = changesFor({ ...item, anilist: entry({ progress: 5 }) }, 'myanimelist');

    expect(changes).toEqual([
      { mediaId: 1, malId: 11, to: 'myanimelist', entry: entry({ progress: 5 }) },
    ]);
  });

  it('keeps a score only the target has, and copies it back to the other list', () => {
    const changes = changesFor(
      { ...item, anilist: entry({ progress: 5, score100: 0 }), myanimelist: entry() },
      'myanimelist'
    );

    expect(
      changes.map((change) => [change.to, change.entry.progress, change.entry.score100])
    ).toEqual([
      ['myanimelist', 5, 80],
      ['anilist', 5, 80],
    ]);
  });

  it('keeps dates only the target has, and copies them back to the other list', () => {
    const changes = changesFor(
      {
        ...item,
        anilist: entry({ progress: 12, startedAt: null, completedAt: '2026-10-30' }),
        myanimelist: entry({ startedAt: '2026-09-01' }),
      },
      'myanimelist'
    );

    expect(
      changes.map(({ to, entry: { startedAt, completedAt } }) => [to, startedAt, completedAt])
    ).toEqual([
      ['myanimelist', '2026-09-01', '2026-10-30'],
      ['anilist', '2026-09-01', '2026-10-30'],
    ]);
  });

  it('has nothing to copy from a list that doesn’t have the anime', () => {
    expect(changesFor({ ...item, myanimelist: null }, 'anilist')).toEqual([]);
  });
});
