import { describe, expect, it } from 'vitest';

import {
  canMix,
  changesFor,
  conflicts,
  defaultMix,
  describeChanges,
  differenceKey,
  importFiles,
  planSync,
  sameEntry,
  type SyncCandidate,
  type SyncEntry,
} from '#lib/sync.js';

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

  it('keeps the entry that has a date the other is missing, however recent the other', () => {
    // The same status and episode; only AniList has the start date, and MyAnimeList changed last
    const [item] = planSync([
      candidate({
        anilist: entry({ progress: 5, startedAt: '2025-06-20', updatedAt: 1_000 }),
        myanimelist: entry({ progress: 5, startedAt: null, updatedAt: 2_000 }),
      }),
    ]);

    expect(item.to).toBe('myanimelist');
    expect(changesFor(item, 'myanimelist').map((change) => change.to)).toEqual(['myanimelist']);
  });

  it('still copies the list changed last when keeping the other would end differently', () => {
    // MyAnimeList is further along, so its episode wins and AniList's date is filled in
    const [item] = planSync([
      candidate({
        anilist: entry({ progress: 5, startedAt: '2025-06-20', updatedAt: 1_000 }),
        myanimelist: entry({ progress: 6, startedAt: null, updatedAt: 2_000 }),
      }),
    ]);

    expect(item.to).toBe('anilist');
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

  it('copies only what’s compared, never the source’s own notes or tags', () => {
    const changes = changesFor(
      { ...item, anilist: entry({ progress: 5, extras: { notes: 'Mine', rewatched: 1 } }) },
      'myanimelist'
    );

    expect(changes[0].entry.extras).toBeUndefined();
  });

  it('doesn’t write to a list that already says the same', () => {
    // Copying MyAnimeList's entry only fills in AniList's own date, which AniList has already
    const changes = changesFor(
      {
        ...item,
        anilist: entry({ startedAt: '2025-06-20' }),
        myanimelist: entry({ startedAt: null }),
      },
      'anilist'
    );

    expect(changes.map(({ to, entry: { startedAt } }) => [to, startedAt])).toEqual([
      ['myanimelist', '2025-06-20'],
    ]);
  });

  it('keeps a finer AniList score that rounds to the copied one', () => {
    const changes = changesFor(
      {
        ...item,
        anilist: entry({ progress: 3, score100: 85 }),
        myanimelist: entry({ progress: 5, score100: 90 }),
      },
      'anilist'
    );

    expect(changes).toEqual([
      expect.objectContaining({ to: 'anilist', entry: expect.objectContaining({ score100: 85 }) }),
    ]);
  });
});

describe('describeChanges', () => {
  const item = { ...candidate({}), to: 'myanimelist' as const };

  it('says what a copy adds to the other list', () => {
    expect(
      describeChanges(
        {
          ...item,
          anilist: entry({ startedAt: '2025-06-20' }),
          myanimelist: entry({ startedAt: null }),
        },
        'myanimelist'
      )
    ).toEqual([{ service: 'myanimelist', text: 'adds the start date 2025-06-20' }]);
  });

  it('says what it changes, in the target’s own words and scores', () => {
    const [change] = describeChanges(
      {
        ...item,
        anilist: entry({ status: 'PAUSED', progress: 7, score100: 75, completedAt: null }),
        myanimelist: entry({
          status: 'COMPLETED',
          progress: 12,
          score100: 90,
          startedAt: '2026-10-02',
          completedAt: '2026-10-30',
        }),
      },
      'myanimelist'
    );

    expect(change.text).toBe(
      'Completed → On-Hold, episode 12 → 7, score 9/10 → 8/10, start date 2026-10-02 → 2026-10-01'
    );
  });

  it('describes an anime added to a list, and a date or score copied back', () => {
    expect(
      describeChanges(
        { ...item, anilist: null, myanimelist: entry({ score100: 0, completedAt: '2026-10-30' }) },
        'anilist'
      )
    ).toEqual([
      {
        service: 'anilist',
        text: 'adds it as Watching, episode 3, started 2026-10-01, finished 2026-10-30',
      },
    ]);
    expect(
      describeChanges(
        { ...item, anilist: entry({ progress: 5, score100: 0 }), myanimelist: entry() },
        'myanimelist'
      )
    ).toEqual([
      { service: 'myanimelist', text: 'episode 3 → 5' },
      { service: 'anilist', text: 'adds the score 8/10' },
    ]);
  });
});

describe('differenceKey', () => {
  it('stays the same until either entry changes in a way that’s compared', () => {
    const item = candidate({ myanimelist: entry({ progress: 5 }) });
    const key = differenceKey(item);

    expect(differenceKey({ ...item, anilist: entry({ updatedAt: 9_000 }) })).toBe(key);
    expect(
      differenceKey({ ...item, anilist: entry({ extras: { notes: 'New', rewatched: 0 } }) })
    ).toBe(key);
    expect(differenceKey({ ...item, myanimelist: entry({ progress: 6 }) })).not.toBe(key);
    expect(differenceKey({ ...item, myanimelist: null })).not.toBe(key);
  });

  it('tells anime apart', () => {
    const item = candidate({ myanimelist: entry({ progress: 5 }) });

    expect(differenceKey({ ...item, malId: 12 })).not.toBe(differenceKey(item));
  });
});

describe('importFiles', () => {
  const aniListExtras = { notes: 'AniList notes', rewatched: 1 };
  const malExtras = {
    notes: 'MAL comments',
    rewatched: 2,
    tags: ['t'],
    priority: 1,
    rewatchValue: 0,
  };
  const item = (overrides: Partial<SyncCandidate>, to: 'anilist' | 'myanimelist') => ({
    ...candidate({
      anilist: entry({ extras: aniListExtras }),
      myanimelist: entry({ progress: 8, extras: malExtras }),
      ...overrides,
    }),
    to,
  });

  it('puts each anime in the file of the site it’s copied to, with that site’s own extras', () => {
    const files = importFiles([item({}, 'anilist')], { 11: 'anilist' });

    expect(files.myanimelist).toEqual([]);
    expect(files.anilist).toEqual([
      {
        malId: 11,
        title: 'Fixture',
        entry: entry({ progress: 8, extras: aniListExtras }),
        update: true,
      },
    ]);
  });

  it('adds an anime the target doesn’t have, with nothing of its own to keep', () => {
    const files = importFiles([item({ myanimelist: null }, 'myanimelist')], {
      11: 'myanimelist',
    });

    expect(files.myanimelist).toEqual([
      expect.objectContaining({
        update: false,
        entry: expect.objectContaining({ extras: undefined }),
      }),
    ]);
  });

  it('follows the choices, leaving out skipped anime', () => {
    const items = [item({}, 'anilist'), { ...item({}, 'anilist'), malId: 12 }];

    const files = importFiles(items, { 11: 'myanimelist', 12: 'skip' });

    expect(files.anilist).toEqual([]);
    expect(files.myanimelist.map((anime) => anime.malId)).toEqual([11]);
  });

  it('copies a date only the target has back to the kept side’s file too', () => {
    const files = importFiles(
      [
        item(
          { myanimelist: entry({ progress: 8, startedAt: null, extras: malExtras }) },
          'anilist'
        ),
      ],
      { 11: 'anilist' }
    );

    expect(files.anilist[0].entry).toMatchObject({ progress: 8, startedAt: '2026-10-01' });
    expect(files.myanimelist[0]).toMatchObject({
      entry: { progress: 8, startedAt: '2026-10-01', extras: malExtras },
      update: true,
    });
  });

  it('keeps an anime out of AniList’s file when it would round a finer AniList score', () => {
    // MyAnimeList's entry is kept but unscored, so AniList's 85 stays, and the file holds tenths only
    const files = importFiles(
      [
        item(
          { anilist: entry({ score100: 85 }), myanimelist: entry({ progress: 8, score100: 0 }) },
          'anilist'
        ),
      ],
      { 11: 'anilist' }
    );

    expect(files.anilist).toEqual([]);
    expect(files.held).toEqual([11]);
    // The score is copied back to MyAnimeList, rounded as MyAnimeList keeps scores
    expect(files.myanimelist.map((anime) => anime.entry.score100)).toEqual([85]);
  });

  it('keeps an anime out of AniList’s file when undoing it would round AniList’s score', () => {
    // MyAnimeList's 7 replaces AniList's 8.5, which the undo file couldn't put back exactly
    const files = importFiles(
      [
        item(
          { anilist: entry({ score100: 85 }), myanimelist: entry({ progress: 8, score100: 70 }) },
          'anilist'
        ),
      ],
      { 11: 'anilist' }
    );

    expect(files.anilist).toEqual([]);
    expect(files.undo).toEqual([]);
    expect(files.held).toEqual([11]);
  });

  it('undoes each AniList update with the entry as AniList has it now, notes included', () => {
    const anilist = entry({ extras: aniListExtras });
    const files = importFiles(
      [
        item({ anilist }, 'anilist'),
        { ...item({ anilist: null }, 'anilist'), malId: 12 },
        { ...item({}, 'myanimelist'), malId: 13 },
      ],
      { 11: 'anilist', 12: 'anilist', 13: 'myanimelist' }
    );

    // An anime the file adds can't be taken off again by an import, and MyAnimeList's updates have
    // its own export as their backup
    expect(files.anilist.map((anime) => anime.malId)).toEqual([11, 12]);
    expect(files.myanimelist.map((anime) => anime.malId)).toEqual([13]);
    expect(files.undo).toEqual([{ malId: 11, title: 'Fixture', entry: anilist, update: true }]);
  });
});

describe('mixing the two entries', () => {
  // Episode 8 watched in MyAnimeList's app, then a new score on AniList the next day
  const split = candidate({
    anilist: entry({ progress: 5, score100: 90, updatedAt: 3_000 }),
    myanimelist: entry({ progress: 8, score100: 70, updatedAt: 2_000 }),
  });

  it('finds the parts the two lists hold different values for', () => {
    expect(conflicts(split)).toEqual(['progress', 'score']);
    expect(canMix(split)).toBe(true);
  });

  it('isn’t offered when only one part disagrees, or one list is only missing something', () => {
    const scoreOnlyOnAniList = candidate({
      anilist: entry({ progress: 5, startedAt: '2025-06-20' }),
      myanimelist: entry({ progress: 8, score100: 0, startedAt: null }),
    });

    expect(conflicts(scoreOnlyOnAniList)).toEqual(['progress']);
    expect(canMix(scoreOnlyOnAniList)).toBe(false);
    expect(canMix(candidate({ myanimelist: null }))).toBe(false);
  });

  it('starts with the episodes from the list further along and the score from the newer one', () => {
    const [item] = planSync([split]);

    expect(defaultMix(item)).toEqual({
      progress: 'myanimelist',
      score: 'anilist',
      startedAt: 'myanimelist',
      completedAt: 'myanimelist',
    });
  });

  it('writes each list the parts the other one had, keeping both latest changes', () => {
    const [item] = planSync([split]);
    const mix = defaultMix(item);

    expect(
      changesFor(item, mix).map(({ to, entry: { progress, score100 } }) => [to, progress, score100])
    ).toEqual([
      ['anilist', 8, 90],
      ['myanimelist', 8, 90],
    ]);
    expect(describeChanges(item, mix)).toEqual([
      { service: 'anilist', text: 'episode 5 → 8' },
      { service: 'myanimelist', text: 'score 7/10 → 9/10' },
    ]);
  });

  it('puts a mixed anime in both sites’ files, with an undo for AniList’s', () => {
    const [item] = planSync([split]);

    const files = importFiles([item], { 11: defaultMix(item) });

    expect(files.anilist.map((anime) => anime.entry.progress)).toEqual([8]);
    expect(files.myanimelist.map((anime) => anime.entry.score100)).toEqual([90]);
    expect(files.undo.map((anime) => anime.entry.progress)).toEqual([5]);
  });

  it('ends the same as copying when every part is taken from one list', () => {
    const allFromMal = {
      progress: 'myanimelist',
      score: 'myanimelist',
      startedAt: 'myanimelist',
      completedAt: 'myanimelist',
    } as const;

    expect(changesFor(split, allFromMal)).toEqual(changesFor(split, 'anilist'));
  });
});
