import type { ActionFailure, Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getListEntry as getAniListEntry,
  saveEntry as saveAniListEntry,
} from '#lib/server/anilist-client.js';
import {
  copyEntry,
  deleteEntry,
  getListEntry,
  getListStatuses,
  MalNotFoundError,
  MalTokenError,
  moveToList,
  saveEntry,
} from '#lib/server/myanimelist-client.js';
import { MyAnimeListApi } from '#lib/server/myanimelist.js';
import type { MalSession, Session } from '#lib/server/session.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

import { actions, load } from './+page.server.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/rate-limit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/rate-limit.js')>()),
  takeClientLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  saveEntry: vi.fn(),
  getListEntry: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  copyEntry: vi.fn(),
  saveEntry: vi.fn(),
  moveToList: vi.fn(),
  getListStatuses: vi.fn(),
  getListEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));
vi.mock('#lib/server/myanimelist.js', () => ({ MyAnimeListApi: vi.fn() }));

const user = { id: 12, name: 'Fixture', avatarUrl: null };
const aniListSession: Session = { token: 'anilist.token.jwt', user: { ...user, id: 99 } };

function malSession(expiresAt = Date.now() + 3_600_000): MalSession {
  return { token: 'mal-token', refreshToken: 'refresh', expiresAt, user };
}

function event(
  malSignIn: MalSession | null,
  fields: Record<string, string> = {},
  aniListSignIn: Session | null = null,
  domain = 'myanimelist'
) {
  const deleted: string[] = [];
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const request = {
    params: { domain, username: 'Fixture' },
    locals: { session: aniListSignIn, malSession: malSignIn, preferences: DEFAULT_PREFERENCES },
    cookies: {
      get: () => undefined,
      set: vi.fn(),
      delete: (name: string) => void deleted.push(name),
    } as unknown as Cookies,
    request: new Request('http://localhost/user/myanimelist/Fixture?/updateEntry', {
      method: 'POST',
      body: form,
    }),
    getClientAddress: () => '127.0.0.1',
    isDataRequest: false,
    url: new URL('http://localhost/user/myanimelist/Fixture'),
  };
  return { request, deleted };
}

const update = (request: ReturnType<typeof event>['request']) =>
  actions.updateEntry!(
    request as unknown as Parameters<NonNullable<typeof actions.updateEntry>>[0]
  );

beforeEach(() => {
  vi.clearAllMocks();
  // MyAnimeList refuses to renew the sign-in
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
  );
  vi.mocked(MyAnimeListApi).mockImplementation(function (signedIn) {
    return {
      getUserAnimeList: vi.fn(async () => ({
        userId: signedIn?.owner.id ?? null,
        username: 'Fixture',
        avatarUrl: null,
        scoreFormat: 'POINT_10' as const,
        animeList: [],
        unmatched: [],
      })),
    } as unknown as MyAnimeListApi;
  });
});

describe('saving to a MyAnimeList list', () => {
  it("saves with the anime's MyAnimeList id and the user's token", async () => {
    const saved = { progress: 3, score: 0, status: 'CURRENT', startedAt: null, completedAt: null };
    vi.mocked(saveEntry).mockResolvedValue(saved);
    const { request } = event(malSession(), {
      mediaId: '7',
      malId: '52991',
      progress: '3',
      episodes: '12',
    });

    expect(await update(request)).toEqual({ mediaId: 7, ...saved });
    expect(saveEntry).toHaveBeenCalledWith('mal-token', 52991, { progress: 3 }, { episodes: 12 });
  });

  it('asks to sign in with MyAnimeList, even when signed in with AniList', async () => {
    const fields = { mediaId: '7', malId: '52991', progress: '3' };
    const { request } = event(null, fields, aniListSession);

    const result = (await update(request)) as ActionFailure<{ message: string }>;

    expect(result.status).toBe(401);
    expect(result.data.message).toBe('Sign in with MyAnimeList to update your list');
    expect(saveEntry).not.toHaveBeenCalled();
  });

  it("signs out of MyAnimeList only, once its sign-in can't be renewed", async () => {
    vi.mocked(saveEntry).mockRejectedValue(new MalTokenError('expired'));
    const { request, deleted } = event(malSession(), { mediaId: '7', malId: '1', progress: '3' });

    const result = (await update(request)) as ActionFailure<{ message: string }>;

    expect(result.status).toBe(401);
    expect(result.data.message).toBe('Your MyAnimeList sign-in expired, please sign in again');
    expect(deleted).toEqual(['session_mal']);
  });
});

describe('adding a sequel from the score prompt', () => {
  const move = (name: 'startWatching' | 'planToWatch', fields: Record<string, string>) => {
    const action = actions[name]!;
    return action(event(malSession(), fields).request as unknown as Parameters<typeof action>[0]);
  };

  it.each([
    ['startWatching', 'CURRENT'],
    ['planToWatch', 'PLANNING'],
  ] as const)('%s moves it to %s on a MyAnimeList list, and nothing else', async (name, status) => {
    const saved = { progress: 0, score: 0, status, startedAt: null, completedAt: null };
    vi.mocked(moveToList).mockResolvedValue(saved);

    expect(await move(name, { mediaId: '7', malId: '1007' })).toEqual({
      mediaId: 7,
      malId: 1007,
      ...saved,
    });
    expect(moveToList).toHaveBeenCalledWith('mal-token', 1007, status);
    expect(saveEntry).not.toHaveBeenCalled();
  });

  it("turns away a sequel MyAnimeList doesn't know", async () => {
    expect(await move('planToWatch', { mediaId: '7' })).toMatchObject({
      status: 400,
      data: { message: 'Unknown anime' },
    });
    expect(moveToList).not.toHaveBeenCalled();
  });
});

describe('adding an anime found by search', () => {
  const add = (fields: Record<string, string>) => {
    const action = actions.addAnime!;
    return action(event(malSession(), fields).request as unknown as Parameters<typeof action>[0]);
  };

  it('asks where it is first, then adds one that is not on the list', async () => {
    const saved = { progress: 0, score: 0, status: 'PLANNING', startedAt: null, completedAt: null };
    vi.mocked(getListStatuses).mockResolvedValue(new Map([[1007, null]]));
    vi.mocked(moveToList).mockResolvedValue(saved);

    expect(await add({ mediaId: '7', malId: '1007', list: 'PLANNING' })).toEqual({
      mediaId: 7,
      malId: 1007,
      ...saved,
      // So the add can be undone
      before: 'NONE',
    });
    expect(getListStatuses).toHaveBeenCalledWith('mal-token', [1007]);
    expect(moveToList).toHaveBeenCalledWith('mal-token', 1007, 'PLANNING');
  });

  it('leaves an anime the user has seen where it is, saying so in their list names', async () => {
    vi.mocked(getListStatuses).mockResolvedValue(new Map([[1007, 'PAUSED']]));

    expect(await add({ mediaId: '7', malId: '1007', list: 'CURRENT' })).toMatchObject({
      status: 409,
      data: { message: 'Already on your On-Hold list' },
    });
    expect(moveToList).not.toHaveBeenCalled();
  });

  it('says a planned anime is planned already, without saving it again', async () => {
    vi.mocked(getListStatuses).mockResolvedValue(new Map([[1007, 'PLANNING']]));

    expect(await add({ mediaId: '7', malId: '1007', list: 'PLANNING' })).toEqual({
      mediaId: 7,
      malId: 1007,
      status: 'PLANNING',
      already: true,
    });
    expect(moveToList).not.toHaveBeenCalled();
  });

  it('resumes a paused one where the page saw it, but not one moved on since', async () => {
    const saved = { progress: 4, score: 0, status: 'CURRENT', startedAt: null, completedAt: null };
    vi.mocked(moveToList).mockResolvedValue(saved);
    vi.mocked(getListStatuses).mockResolvedValueOnce(new Map([[1007, 'PAUSED']]));

    expect(
      await add({ mediaId: '7', malId: '1007', list: 'CURRENT', from: 'PAUSED' })
    ).toMatchObject({ status: 'CURRENT', before: 'PAUSED' });

    vi.mocked(moveToList).mockClear();
    vi.mocked(getListStatuses).mockResolvedValueOnce(new Map([[1007, 'COMPLETED']]));
    expect(
      await add({ mediaId: '7', malId: '1007', list: 'CURRENT', from: 'PAUSED' })
    ).toMatchObject({ status: 409, data: { message: 'Already on your Completed list' } });
    expect(moveToList).not.toHaveBeenCalled();
  });

  it('only tries the linked account again when asked to, once the add is done', async () => {
    vi.mocked(getListStatuses).mockResolvedValue(new Map([[1007, 'PLANNING']]));

    expect(await add({ mediaId: '7', malId: '1007', list: 'PLANNING', retry: 'linked' })).toEqual({
      mediaId: 7,
      malId: 1007,
      linkedOnly: true,
    });
    expect(moveToList).not.toHaveBeenCalled();
  });

  describe('from a page that read the list itself', () => {
    it('adds a new anime in one request, without asking where it is', async () => {
      const saved = {
        progress: 0,
        score: 0,
        status: 'PLANNING',
        startedAt: null,
        completedAt: null,
      };
      vi.mocked(moveToList).mockResolvedValue(saved);

      expect(
        await add({ mediaId: '7', malId: '1007', list: 'PLANNING', from: 'NONE', known: '1' })
      ).toEqual({ mediaId: 7, malId: 1007, ...saved, before: 'NONE' });
      expect(getListStatuses).not.toHaveBeenCalled();
      expect(moveToList).toHaveBeenCalledTimes(1);
    });

    it('starts a planned one in one request, and remembers where it was for Undo', async () => {
      const saved = {
        progress: 0,
        score: 0,
        status: 'CURRENT',
        startedAt: null,
        completedAt: null,
      };
      vi.mocked(moveToList).mockResolvedValue(saved);

      expect(
        await add({ mediaId: '7', malId: '1007', list: 'CURRENT', from: 'PLANNING', known: '1' })
      ).toMatchObject({ status: 'CURRENT', before: 'PLANNING' });
      expect(getListStatuses).not.toHaveBeenCalled();
    });

    it('still asks when the page says nothing of where it saw it, or tries the linked account again', async () => {
      vi.mocked(getListStatuses).mockResolvedValue(new Map([[1007, 'PLANNING']]));

      await add({ mediaId: '7', malId: '1007', list: 'PLANNING', known: '1' });
      expect(
        await add({
          mediaId: '7',
          malId: '1007',
          list: 'PLANNING',
          from: 'NONE',
          known: '1',
          retry: 'linked',
        })
      ).toMatchObject({ linkedOnly: true });

      expect(getListStatuses).toHaveBeenCalledTimes(2);
      expect(moveToList).not.toHaveBeenCalled();
    });

    it("says MyAnimeList doesn't have the anime when the save finds it missing", async () => {
      vi.mocked(moveToList).mockRejectedValue(new MalNotFoundError('not found'));

      expect(
        await add({ mediaId: '7', malId: '1007', list: 'CURRENT', from: 'NONE', known: '1' })
      ).toMatchObject({ status: 404, data: { message: "MyAnimeList doesn't have this anime" } });
    });

    it('adds to an AniList list with only the save', async () => {
      const saved = {
        progress: 0,
        score: 0,
        status: 'PLANNING',
        startedAt: null,
        completedAt: null,
      };
      vi.mocked(saveAniListEntry).mockResolvedValue(saved);
      const action = actions.addAnime!;
      const fields = { mediaId: '7', list: 'PLANNING', from: 'NONE', known: '1' };
      const request = event(null, fields, aniListSession, 'anilist').request;

      expect(await action(request as unknown as Parameters<typeof action>[0])).toMatchObject({
        status: 'PLANNING',
        before: 'NONE',
      });
      expect(saveAniListEntry).toHaveBeenCalledTimes(1);
      // Nothing else reached AniList: no read of where it was
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it("turns away an anime MyAnimeList doesn't have, and a list it can't add to", async () => {
    vi.mocked(getListStatuses).mockResolvedValue(new Map());

    expect(await add({ mediaId: '7', malId: '1007', list: 'CURRENT' })).toMatchObject({
      status: 404,
    });
    expect(await add({ mediaId: '7', malId: '1007', list: 'COMPLETED' })).toMatchObject({
      status: 400,
      data: { message: 'Unknown list' },
    });
    expect(moveToList).not.toHaveBeenCalled();
  });
});

describe('undoing an add from the search', () => {
  const undo = (fields: Record<string, string>) => {
    const action = actions.undoAdd!;
    return action(event(malSession(), fields).request as unknown as Parameters<typeof action>[0]);
  };
  const entry = (status: string, progress = 0, score = 0) => ({
    status,
    progress,
    score,
    rewatched: 0,
    startedAt: null,
    completedAt: null,
  });
  const fields = (list: string, before: string) => ({ mediaId: '7', malId: '1007', list, before });
  const changedSince = {
    status: 409,
    data: {
      message: "It's changed since you added it, so it stays as it is. Change it on its card.",
    },
  };

  it('takes a new anime off the list while it holds nothing but its status', async () => {
    vi.mocked(getListEntry).mockResolvedValue(entry('PLANNING'));

    expect(await undo(fields('PLANNING', 'NONE'))).toEqual({
      mediaId: 7,
      malId: 1007,
      undone: true,
    });
    expect(deleteEntry).toHaveBeenCalledWith('mal-token', 1007);
  });

  it('keeps one watched or scored since, saying where to change it', async () => {
    vi.mocked(getListEntry).mockResolvedValue(entry('CURRENT', 3));

    expect(await undo(fields('CURRENT', 'NONE'))).toMatchObject(changedSince);
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it('moves a moved anime back while it is still where the add put it', async () => {
    vi.mocked(getListEntry).mockResolvedValue(entry('CURRENT', 4));
    vi.mocked(moveToList).mockResolvedValue({
      progress: 4,
      score: 0,
      status: 'PAUSED',
      startedAt: null,
      completedAt: null,
    });

    expect(await undo(fields('CURRENT', 'PAUSED'))).toMatchObject({ undone: true });
    expect(moveToList).toHaveBeenCalledWith('mal-token', 1007, 'PAUSED');
  });

  it('leaves one moved on since, as one started and then completed', async () => {
    vi.mocked(getListEntry).mockResolvedValue(entry('COMPLETED', 12, 8));

    expect(await undo(fields('CURRENT', 'PLANNING'))).toMatchObject(changedSince);
    expect(moveToList).not.toHaveBeenCalled();
  });

  it('leaves one watched since a start, when the history says what the start left', async () => {
    vi.mocked(getListEntry).mockResolvedValue(entry('CURRENT', 2));

    expect(await undo({ ...fields('CURRENT', 'PLANNING'), progress: '0' })).toMatchObject(
      changedSince
    );
    expect(moveToList).not.toHaveBeenCalled();

    vi.mocked(getListEntry).mockResolvedValue(entry('CURRENT', 0));
    vi.mocked(moveToList).mockResolvedValue({
      progress: 0,
      score: 0,
      status: 'PLANNING',
      startedAt: null,
      completedAt: null,
    });
    expect(await undo({ ...fields('CURRENT', 'PLANNING'), progress: '0' })).toMatchObject({
      undone: true,
    });
    expect(moveToList).toHaveBeenCalledWith('mal-token', 1007, 'PLANNING');
  });

  it('turns away anything else to undo', async () => {
    expect(await undo(fields('CURRENT', 'COMPLETED'))).toMatchObject({
      status: 400,
      data: { message: 'Nothing to undo' },
    });
    expect(await undo(fields('COMPLETED', 'NONE'))).toMatchObject({ status: 400 });
    expect(getListEntry).not.toHaveBeenCalled();
  });
});

describe('reading your own MyAnimeList list', () => {
  it("falls back to the public list once the sign-in can't be renewed", async () => {
    const { request, deleted } = event(malSession(Date.now() - 1));

    const page = await load(request as unknown as Parameters<typeof load>[0]);

    expect(deleted).toEqual(['session_mal']);
    expect(page).toMatchObject({ domain: 'myanimelist', canEdit: false });
    expect(MyAnimeListApi).toHaveBeenCalledTimes(1);
    expect(MyAnimeListApi).toHaveBeenCalledWith();
  });

  it('reads it with the token and lets its owner edit it', async () => {
    const { request } = event(malSession());

    const page = await load(request as unknown as Parameters<typeof load>[0]);

    expect(page).toMatchObject({ canEdit: true, username: 'Fixture' });
    expect(MyAnimeListApi).toHaveBeenCalledWith({ token: 'mal-token', owner: user });
  });
});

describe('finishing an anime on AniList', () => {
  const finishing = { mediaId: '7', progress: '12', episodes: '12' };
  const saved = (status: string) => ({
    progress: 12,
    score: 0,
    status,
    startedAt: '2026-10-01',
    completedAt: '2026-11-11',
  });

  it('reads the entry first, so the history can put back what the finish changed', async () => {
    vi.mocked(getAniListEntry).mockResolvedValue({
      id: 900,
      status: 'REPEATING',
      progress: 11,
      score: 0,
      repeat: 1,
      startedAt: '2025-01-02',
      completedAt: '2025-03-04',
    });
    vi.mocked(saveAniListEntry).mockResolvedValue(saved('COMPLETED'));
    const { request } = event(null, finishing, aniListSession, 'anilist');

    expect(await update(request)).toEqual({
      mediaId: 7,
      ...saved('COMPLETED'),
      beforeFinish: {
        rewatched: 1,
        startedAt: '2025-01-02',
        completedAt: '2025-03-04',
        added: [],
      },
    });
    expect(saveAniListEntry).toHaveBeenCalledWith('anilist.token.jwt', 7, { progress: 12 });
  });

  it('says which dates the finish set, which the entry had none of', async () => {
    vi.mocked(getAniListEntry).mockResolvedValue({
      id: 900,
      status: 'CURRENT',
      progress: 11,
      score: 0,
      repeat: 0,
      startedAt: '2026-10-01',
      completedAt: null,
    });
    vi.mocked(saveAniListEntry).mockResolvedValue(saved('COMPLETED'));
    const { request } = event(null, finishing, aniListSession, 'anilist');

    expect(await update(request)).toMatchObject({
      beforeFinish: { completedAt: null, added: ['completedAt'] },
    });
  });

  it('saves the finish all the same when the read for the history fails', async () => {
    vi.mocked(getAniListEntry).mockRejectedValue(new Error('AniList is down'));
    vi.mocked(saveAniListEntry).mockResolvedValue(saved('COMPLETED'));
    const { request } = event(null, finishing, aniListSession, 'anilist');

    expect(await update(request)).toEqual({ mediaId: 7, ...saved('COMPLETED') });
  });

  it('saves any other episode in a single request', async () => {
    vi.mocked(saveAniListEntry).mockResolvedValue(saved('CURRENT'));
    const { request } = event(
      null,
      { mediaId: '7', progress: '11', episodes: '12' },
      aniListSession,
      'anilist'
    );

    expect(await update(request)).not.toHaveProperty('beforeFinish');
    expect(getAniListEntry).not.toHaveBeenCalled();
  });
});

describe('reverting a save from the history', () => {
  const revert = (fields: Record<string, string>, aniListSignIn: Session | null = null) => {
    const action = actions.revertEntry!;
    return action(
      event(malSession(), fields, aniListSignIn).request as unknown as Parameters<typeof action>[0]
    );
  };
  const held = (progress: number, score = 0, status = 'CURRENT') => ({
    status,
    progress,
    score,
    rewatched: 0,
    startedAt: null,
    completedAt: null,
  });
  const episode = {
    mediaId: '7',
    malId: '1007',
    before: JSON.stringify({ progress: 4 }),
    after: JSON.stringify({ progress: 5 }),
  };

  it('puts the episode count back while it is what the save left', async () => {
    vi.mocked(getListEntry).mockResolvedValue(held(5, 8));

    expect(await revert(episode)).toEqual({
      mediaId: 7,
      malId: 1007,
      reverted: true,
      ...held(4, 8),
      rewatched: undefined,
    });
    expect(copyEntry).toHaveBeenCalledWith(
      'mal-token',
      1007,
      { status: 'CURRENT', progress: 4, score: 8, startedAt: null, completedAt: null },
      { countRewatch: false }
    );
  });

  it('leaves one changed since, saying so', async () => {
    vi.mocked(getListEntry).mockResolvedValue(held(6));

    expect(await revert(episode)).toMatchObject({
      status: 409,
      data: { message: "It's changed since, so it stays as it is." },
    });
    expect(copyEntry).not.toHaveBeenCalled();
  });

  it('puts a score back, in MyAnimeList’s scores whatever the form says', async () => {
    vi.mocked(getListEntry).mockResolvedValue(held(12, 9, 'COMPLETED'));

    await revert({
      malId: '1007',
      scoreFormat: 'POINT_100',
      before: JSON.stringify({ score: 0 }),
      after: JSON.stringify({ score: 9 }),
    });

    expect(copyEntry).toHaveBeenCalledWith(
      'mal-token',
      1007,
      expect.objectContaining({ status: 'COMPLETED', progress: 12, score: 0 }),
      { countRewatch: false }
    );
  });

  it('copies the revert to the linked AniList account, as a save is copied', async () => {
    vi.mocked(getListEntry).mockResolvedValue(held(5));

    await revert(episode, aniListSession);

    expect(saveAniListEntry).toHaveBeenCalledWith('anilist.token.jwt', 7, {
      progress: 4,
      status: 'CURRENT',
      startedAt: null,
      completedAt: null,
      clear: [],
    });
  });

  it('reverts a finish on AniList, then on the linked MyAnimeList: its dates and rewatch', async () => {
    vi.mocked(getAniListEntry).mockResolvedValue({
      id: 900,
      status: 'COMPLETED',
      progress: 12,
      score: 0,
      repeat: 2,
      startedAt: '2025-01-02',
      completedAt: '2026-11-11',
    });
    const restored = {
      progress: 11,
      score: 0,
      status: 'REPEATING',
      startedAt: '2025-01-02',
      completedAt: null,
    };
    vi.mocked(saveAniListEntry).mockResolvedValue(restored);
    const beforeFinish = { rewatched: 1, startedAt: '2025-01-02', completedAt: null };
    const action = actions.revertEntry!;
    const { request } = event(
      malSession(),
      {
        mediaId: '7',
        malId: '1007',
        before: JSON.stringify({ status: 'REPEATING', progress: 11 }),
        after: JSON.stringify({ status: 'COMPLETED', progress: 12 }),
        beforeFinish: JSON.stringify({ ...beforeFinish, added: ['completedAt'] }),
      },
      aniListSession,
      'anilist'
    );

    expect(await action(request as unknown as Parameters<typeof action>[0])).toEqual({
      mediaId: 7,
      malId: 1007,
      reverted: true,
      ...restored,
    });
    expect(saveAniListEntry).toHaveBeenCalledWith('anilist.token.jwt', 7, {
      status: 'REPEATING',
      progress: 11,
      startedAt: '2025-01-02',
      completedAt: null,
      repeat: 1,
      clear: ['completedAt'],
    });
    // Only the date the finish set is cleared there, and the rewatch its copy counted taken back
    expect(copyEntry).toHaveBeenCalledWith(
      'mal-token',
      1007,
      expect.objectContaining({ status: 'REPEATING', progress: 11, clear: ['completedAt'] }),
      { countRewatch: false, uncountRewatch: true }
    );
  });

  it('turns away a form that names nothing to revert, or different fields before and after', async () => {
    expect(await revert({ malId: '1007', before: '{}', after: '{}' })).toMatchObject({
      status: 400,
      data: { message: 'Nothing to revert' },
    });
    expect(
      await revert({ malId: '1007', before: '{"progress":4}', after: '{"score":8}' })
    ).toMatchObject({ status: 400 });
    expect(getListEntry).not.toHaveBeenCalled();
  });
});
