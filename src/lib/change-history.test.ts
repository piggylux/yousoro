import { describe, expect, it } from 'vitest';

import {
  accountFor,
  describeChange,
  listChanges,
  forgetChange,
  MAX_CHANGES,
  pruneChanges,
  recordChange,
  revertForm,
  revertState,
  savedChange,
  updateChange,
  type ChangeAccount,
  type ListChange,
  type NewChange,
} from '#lib/change-history.js';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const aniList = { domain: 'anilist' as const, id: 1, name: 'Fixture' };
const mal = { domain: 'myanimelist' as const, id: 2, name: 'Fixture' };

function episode(anime = 7, progress = 4, account: ChangeAccount = aniList): NewChange {
  return {
    kind: 'entry',
    account,
    anime: {
      mediaId: anime,
      malId: anime + 1000,
      title: `Anime ${anime}`,
      coverUrl: null,
      isAdult: false,
    },
    before: { progress },
    after: { progress: progress + 1 },
  };
}

describe('keeping changes in the tab', () => {
  it('keeps the newest first, and the latest MAX_CHANGES', () => {
    const storage = memoryStorage();
    for (let progress = 0; progress < MAX_CHANGES + 5; progress++) {
      recordChange(episode(7, progress), storage, 1000 + progress);
    }

    const changes = listChanges(storage);
    expect(changes).toHaveLength(MAX_CHANGES);
    expect(changes[0]).toMatchObject({ at: 1000 + MAX_CHANGES + 4, after: { progress: 105 } });
  });

  it('keeps nothing for a change that changed nothing', () => {
    const storage = memoryStorage();

    expect(recordChange({ ...episode(), after: { progress: 4 } }, storage)).toBeNull();
    expect(listChanges(storage)).toEqual([]);
  });

  it('goes without history when storage is missing, refuses, or holds something else', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };

    expect(recordChange(episode(), null)).toEqual(expect.any(String));
    expect(listChanges(null)).toEqual([]);
    expect(() => recordChange(episode(), refusing)).not.toThrow();
    expect(listChanges(refusing)).toEqual([]);
    const odd = memoryStorage();
    odd.setItem('yousoro:changes', JSON.stringify([{ id: 1 }, 'text']));
    expect(listChanges(odd)).toEqual([]);
  });

  it('adds what a retry found on the linked account to a change', () => {
    const storage = memoryStorage();
    const id = recordChange({ ...episode(), kind: 'move' }, storage)!;

    updateChange(id, { linkedBefore: 'PLANNING' }, storage);
    expect(listChanges(storage)[0]).toMatchObject({ id, linkedBefore: 'PLANNING' });
  });

  it('takes a reverted change off the history, and only that one', () => {
    const storage = memoryStorage();
    const kept = recordChange(episode(8), storage, 1)!;
    const reverted = recordChange(episode(7), storage, 2)!;

    expect(forgetChange(reverted, storage).map(({ id }) => id)).toEqual([kept]);
    expect(listChanges(storage).map(({ id }) => id)).toEqual([kept]);
    expect(forgetChange('gone', storage)).toHaveLength(1);
  });

  it('drops the changes of an account that signed out, and only those', () => {
    const storage = memoryStorage();
    recordChange(episode(7, 4, aniList), storage);
    recordChange(episode(7, 4, mal), storage);

    expect(pruneChanges([mal], storage).map(({ account }) => account.domain)).toEqual([
      'myanimelist',
    ]);
    expect(listChanges(storage)).toHaveLength(1);
    expect(pruneChanges([], storage)).toEqual([]);
  });

  it('knows which account a change on each service is made on', () => {
    const user = { id: 1, name: 'Fixture', avatarUrl: null };

    expect(accountFor('anilist', user, null)).toEqual(aniList);
    expect(accountFor('myanimelist', user, null)).toBeNull();
  });
});

describe('reverting changes one at a time', () => {
  function history(...changes: NewChange[]) {
    const storage = memoryStorage();
    for (const [index, change] of changes.entries()) recordChange(change, storage, index);
    return listChanges(storage);
  }

  it('reverts the latest change of each anime first', () => {
    const all = history(episode(7, 4), episode(8, 1), episode(7, 5));
    const [newest, other, oldest] = all;

    expect(newest.after).toEqual({ progress: 6 });
    expect(revertState(newest, all)).toBe('revertible');
    expect(revertState(other, all)).toBe('revertible');
    expect(revertState(oldest, all)).toBe('later');
  });

  it('lets the one before go once the latest is reverted', () => {
    const storage = memoryStorage();
    const first = recordChange(episode(7, 4), storage, 1)!;
    const second = recordChange(episode(7, 5), storage, 2)!;

    expect(revertState(listChanges(storage)[1], listChanges(storage))).toBe('later');
    const changes = forgetChange(second, storage);
    expect(changes.map(({ id }) => id)).toEqual([first]);
    expect(revertState(changes[0], changes)).toBe('revertible');
  });

  it('knows a MyAnimeList plan list anime by its MyAnimeList id, which a card shares', () => {
    const card = episode(7, 4, mal);
    const planned: NewChange = {
      kind: 'move',
      account: mal,
      anime: { malId: 1007, title: 'Anime 7', coverUrl: null, isAdult: false },
      before: { status: 'PLANNING' },
      after: { status: 'CURRENT', progress: 0 },
    };
    const [newest, oldest] = history(planned, card);

    expect(revertState(oldest, [newest, oldest])).toBe('later');
  });
});

describe('what a save changed', () => {
  const found = { status: 'CURRENT', progress: 4, score: 0 };

  it('keeps the fields the save changed alone', () => {
    expect(savedChange(found, { ...found, progress: 5 }, false)).toEqual({
      before: { progress: 4 },
      after: { progress: 5 },
    });
  });

  it('keeps the score only when the save set it, as one changed elsewhere isn’t its own', () => {
    const after = { ...found, progress: 5, score: 8 };

    expect(savedChange(found, after, false).after).toEqual({ progress: 5 });
    expect(savedChange(found, after, true).after).toEqual({ progress: 5, score: 8 });
  });

  it('keeps a finish with what it changed besides', () => {
    const beforeFinish = { rewatched: 0, startedAt: null, completedAt: null, added: [] };

    expect(
      savedChange(found, { ...found, status: 'COMPLETED', progress: 12 }, false, beforeFinish)
    ).toEqual({
      before: { status: 'CURRENT', progress: 4 },
      after: { status: 'COMPLETED', progress: 12 },
      beforeFinish,
    });
  });
});

describe('describing a change', () => {
  const change = (fields: Partial<ListChange>): ListChange => ({
    ...(episode() as ListChange),
    id: 'id',
    at: 0,
    ...fields,
  });

  it.each([
    [{ before: { progress: 4 }, after: { progress: 5 } }, ['Watched episode 5']],
    [{ before: { progress: 4 }, after: { progress: 7 } }, ['Watched up to episode 7 (was 4)']],
    [{ before: { progress: 4 }, after: { progress: 2 } }, ['Set back to episode 2 (was 4)']],
    [
      {
        before: { progress: 11, status: 'CURRENT' },
        after: { progress: 12, status: 'COMPLETED' },
      },
      ['Finished at episode 12 (was 11)'],
    ],
    [
      {
        before: { progress: 11, status: 'REPEATING' },
        after: { progress: 12, status: 'COMPLETED' },
      },
      ['Finished rewatching at episode 12 (was 11)'],
    ],
    [
      { before: { score: 0 }, after: { score: 8 }, scoreFormat: 'POINT_10' as const },
      ['Scored 8 out of 10 (was not scored)'],
    ],
    [
      { before: { score: 3 }, after: { score: 0 }, scoreFormat: 'POINT_5' as const },
      ['Took the score off (was 3 out of 5)'],
    ],
    [
      {
        before: { progress: 4, score: 0 },
        after: { progress: 6, score: 2 },
        scoreFormat: 'POINT_3' as const,
      },
      ['Watched up to episode 6 (was 4)', 'Scored Neutral (was not scored)'],
    ],
  ])('says what a save did: %o', (fields, lines) => {
    expect(describeChange(change(fields))).toEqual(lines);
  });

  it.each([
    [{ before: null, after: { status: 'PLANNING' } }, 'Added to your plan list'],
    [{ before: null, after: { status: 'CURRENT' } }, 'Added to Watching'],
    [
      { before: { status: 'PLANNING' }, after: { status: 'CURRENT' } },
      'Started watching (was planned)',
    ],
    [
      { before: { status: 'PAUSED' }, after: { status: 'CURRENT' }, account: mal },
      'Started watching again (was On-Hold)',
    ],
  ])('says where a move took it: %o', (fields, line) => {
    expect(describeChange(change({ kind: 'move', ...fields }))).toEqual([line]);
  });

  it('says a removal took it off the plan list', () => {
    expect(
      describeChange(change({ kind: 'remove', before: { status: 'PLANNING' }, after: null }))
    ).toEqual(['Removed from your plan list']);
  });
});

describe('the form that reverts a change', () => {
  const change = (fields: Partial<ListChange>): ListChange => ({
    ...(episode() as ListChange),
    id: 'id',
    at: 0,
    ...fields,
  });

  it("reverts a save with the list page's own action, sending what it changed", () => {
    const beforeFinish = {
      rewatched: 0,
      startedAt: null,
      completedAt: null,
      added: ['completedAt' as const],
    };

    expect(
      revertForm(
        change({
          before: { progress: 11, status: 'CURRENT' },
          after: { progress: 12, status: 'COMPLETED' },
          beforeFinish,
          scoreFormat: 'POINT_100',
        })
      )
    ).toEqual({
      action: '/user/anilist/Fixture?/revertEntry',
      fields: {
        mediaId: '7',
        malId: '1007',
        before: JSON.stringify({ progress: 11, status: 'CURRENT' }),
        after: JSON.stringify({ progress: 12, status: 'COMPLETED' }),
        scoreFormat: 'POINT_100',
        beforeFinish: JSON.stringify(beforeFinish),
      },
    });
  });

  it('undoes a start from the plan list as an add is undone, back to Planning on both', () => {
    expect(
      revertForm(
        change({
          kind: 'move',
          before: { status: 'PLANNING' },
          after: { status: 'CURRENT', progress: 0 },
          linkedBefore: 'PLANNING',
        })
      )
    ).toEqual({
      action: '/user/anilist/Fixture?/undoAdd',
      fields: {
        mediaId: '7',
        malId: '1007',
        list: 'CURRENT',
        before: 'PLANNING',
        progress: '0',
        linkedBefore: 'PLANNING',
      },
    });
  });

  it('leaves the linked account alone when the move left it alone', () => {
    // An add from the search that found the anime being watched there already
    const { fields } = revertForm(
      change({ kind: 'move', before: { status: 'PLANNING' }, after: { status: 'CURRENT' } })
    );

    expect(fields).toMatchObject({ list: 'CURRENT', before: 'PLANNING' });
    expect(fields).not.toHaveProperty('linkedBefore');
  });

  it('never takes an anime off the linked list that a move only copied there', () => {
    const { fields } = revertForm(
      change({ kind: 'move', before: null, after: { status: 'PLANNING', progress: 0 } })
    );

    expect(fields).toMatchObject({ list: 'PLANNING', before: 'NONE' });
    expect(fields).not.toHaveProperty('linkedBefore');
    // Where an add from the search found it there, it's put back there
    expect(
      revertForm(
        change({
          kind: 'move',
          before: null,
          after: { status: 'PLANNING' },
          linkedBefore: 'NONE',
        })
      ).fields
    ).toMatchObject({ linkedBefore: 'NONE' });
  });

  it("undoes a removal with the plan page's Undo, on the linked account when it was removed there", () => {
    expect(
      revertForm(
        change({
          kind: 'remove',
          account: mal,
          anime: { malId: 1007, title: 'Anime', coverUrl: null, isAdult: false },
          before: { status: 'PLANNING' },
          after: null,
          linkedRemoved: true,
        })
      )
    ).toEqual({
      action: '/user/myanimelist/Fixture/planning?/undoRemove',
      fields: { malId: '1007', linkedRemoved: 'true' },
    });
  });
});
