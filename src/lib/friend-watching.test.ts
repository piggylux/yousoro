import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  getOwnSharedAnime,
  loadFriendsWatching,
  seedOwnAnime,
  setFriendsViewer,
  withoutListOwner,
  recordOwnWatchingEntry,
  runFriendsLookup,
} from '#lib/friend-watching.js';
import type { Anime } from '#lib/types/anime.js';
import type { FriendsLookupState } from '#lib/types/friend-watching.js';

const friend = { id: 2, name: 'Friend', avatarUrl: null, progress: 3, rewatching: false };
const user = { id: 10, name: 'Me', avatarUrl: null };
const me = { ...user, progress: 3, rewatching: false, isViewer: true };
function savedAnime(progress: number): Anime {
  return {
    id: 1,
    malId: null,
    title: 'Anime',
    englishTitle: null,
    otherTitles: [],
    thumbnailUrl: 'https://s4.anilist.co/cover.jpg',
    status: 'RELEASING',
    isAdult: false,
    meanScore: null,
    userScore: null,
    currentEpisode: progress,
    rewatching: false,
    lastUpdatedAt: null,
    nextEpisode: null,
    recentEpisodeAiredAt: null,
    numberAiredEpisodes: 10,
    endDate: new Date(),
    numberEpisodes: 12,
  };
}

beforeEach(() => {
  setFriendsViewer(null);
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(async () => Response.json({ matches: { 1: [friend] }, partial: false }))
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('friend lookup reuse', () => {
  it('also joins overlapping batches started while waiting for an earlier request', async () => {
    let releaseFirst!: (response: Response) => void;
    let releaseLater!: (response: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseLater = resolve;
          })
      );
    const first = loadFriendsWatching(10, [1]);
    const waiting = loadFriendsWatching(10, [1, 2]);
    const later = loadFriendsWatching(10, [2, 3]);
    releaseFirst(Response.json({ matches: {}, partial: false }));
    await first;
    expect(fetch).toHaveBeenCalledTimes(2);
    releaseLater(Response.json({ matches: { 2: [friend] }, partial: false }));
    await later;
    expect((await waiting).matches[2]).toEqual([friend]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('joins overlapping requests and fetches only the additional IDs', async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const first = loadFriendsWatching(10, [1, 2]);
    const second = loadFriendsWatching(10, [2, 3]);
    expect(fetch).toHaveBeenCalledTimes(1);
    release(Response.json({ matches: { 2: [friend] }, partial: false }));
    await first;
    expect((await second).matches[2]).toEqual([friend]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).mediaIds).toEqual([3]);
  });
  it('retains partial overlapping results without treating missing matches as covered', async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const first = loadFriendsWatching(10, [1, 2]);
    const second = loadFriendsWatching(10, [2]);
    release(Response.json({ matches: { 2: [friend] }, partial: true }));
    await first;
    expect(await second).toEqual({ matches: { 2: [friend] }, partial: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    await loadFriendsWatching(10, [2]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps matches from earlier batches when a later batch reaches the rate limit', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => index + 1);
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ matches: { 1: [friend] }, partial: false }))
      .mockResolvedValueOnce(
        Response.json(
          { matches: { 501: [friend] }, partial: true, retryAfter: 30 },
          { headers: { 'Retry-After': '30' } }
        )
      );
    const result = await loadFriendsWatching(10, ids);
    expect(result).toMatchObject({
      matches: { 1: [friend], 501: [friend] },
      partial: true,
      retryAfter: 30,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    await loadFriendsWatching(10, ids);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[3][1]!.body as string).mediaIds).toEqual([1001]);
  });
  it('does not restart the cooldown when cached partial results are reused', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        { matches: { 1: [friend] }, partial: true, retryAfter: 30 },
        { headers: { 'Retry-After': '30' } }
      )
    );
    await loadFriendsWatching(10, [1]);
    await vi.advanceTimersByTimeAsync(10000);
    expect((await loadFriendsWatching(10, [1])).retryAfter).toBe(20);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: 401, source: 'matches', finishCurrentFirst: false },
    { status: 401, source: 'own', finishCurrentFirst: true },
    { status: 429, source: 'matches', finishCurrentFirst: true },
    { status: 429, source: 'own', finishCurrentFirst: false },
  ])(
    'ignores a stale $status from $source after switching accounts',
    async ({ status, source, finishCurrentFirst }) => {
      const responses: ((response: Response) => void)[] = [];
      vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => responses.push(resolve)));
      const old = (source === 'own' ? getOwnSharedAnime(10) : loadFriendsWatching(10, [1])).catch(
        (error: Error) => error.message
      );
      setFriendsViewer(20);
      const current = loadFriendsWatching(20, [1]);
      if (finishCurrentFirst) {
        responses[1](Response.json({ matches: { 1: [friend] }, partial: false }));
        await current;
      }
      responses[0](new Response('', { status, headers: { 'Retry-After': '60' } }));
      expect(await old).toBe('Account changed.');
      if (!finishCurrentFirst)
        responses[1](Response.json({ matches: { 1: [friend] }, partial: false }));
      expect((await current).matches[1]).toEqual([friend]);
      await loadFriendsWatching(20, [1]);
      expect(fetch).toHaveBeenCalledTimes(2);
      vi.mocked(fetch).mockImplementation(async () =>
        Response.json({ matches: {}, partial: false })
      );
      await loadFriendsWatching(20, [2]);
      expect(fetch).toHaveBeenCalledTimes(3);
    }
  );
  it.each([false, true])(
    'patches confirmed own progress, rewatching and completion in cached matches (partial=%s)',
    async (partial) => {
      seedOwnAnime(10, [{ id: 1, title: 'Anime', isAdult: false }]);
      vi.mocked(fetch).mockImplementation(async () =>
        Response.json({ matches: { 1: [me, friend] }, partial })
      );
      await loadFriendsWatching(10, [1]);
      recordOwnWatchingEntry(user, savedAnime(4), 'CURRENT');
      expect((await loadFriendsWatching(10, [1])).matches[1]).toEqual([
        { ...me, progress: 4 },
        friend,
      ]);
      recordOwnWatchingEntry(user, savedAnime(5), 'REPEATING');
      expect((await loadFriendsWatching(10, [1])).matches[1][0]).toMatchObject({
        progress: 5,
        rewatching: true,
      });
      recordOwnWatchingEntry(user, savedAnime(12), 'COMPLETED');
      expect((await loadFriendsWatching(10, [1])).matches[1]).toEqual([friend]);
      expect(await getOwnSharedAnime(10)).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );
  it('adds a confirmed own entry to previously empty matches without fetching friends again', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ matches: {}, partial: false }));
    await loadFriendsWatching(10, [1]);
    recordOwnWatchingEntry(user, savedAnime(4), 'CURRENT');
    expect((await loadFriendsWatching(10, [1])).matches[1]).toEqual([{ ...me, progress: 4 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not let a pre-save match response overwrite confirmed progress', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const pending = loadFriendsWatching(10, [1]);
    recordOwnWatchingEntry(user, savedAnime(4), 'CURRENT');
    resolve(Response.json({ matches: { 1: [me, friend] }, partial: false }));
    expect((await pending).matches[1][0]).toMatchObject({ progress: 4 });
    expect((await loadFriendsWatching(10, [1])).matches[1][0]).toMatchObject({ progress: 4 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not let a pre-completion own-list response reintroduce a completed anime', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const pending = getOwnSharedAnime(10);
    recordOwnWatchingEntry(user, savedAnime(12), 'COMPLETED');
    resolve(Response.json([{ id: 1, title: 'Anime', isAdult: false }]));
    expect(await pending).toEqual([]);
    expect(await getOwnSharedAnime(10)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps fresh post-save server results authoritative', async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(async () => Response.json({ matches: { 1: [me] }, partial: true }))
      .mockImplementationOnce(async () =>
        Response.json({ matches: { 1: [{ ...me, progress: 8 }] }, partial: false })
      );
    await loadFriendsWatching(10, [1, 2]);
    recordOwnWatchingEntry(user, savedAnime(4), 'CURRENT');
    expect((await loadFriendsWatching(10, [1])).matches[1][0].progress).toBe(8);
  });
  it('ignores confirmed updates for an old account', async () => {
    await loadFriendsWatching(20, [1]);
    recordOwnWatchingEntry(user, savedAnime(4), 'CURRENT');
    expect((await loadFriendsWatching(20, [1])).matches[1]).toEqual([friend]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([429, 502])(
    'reports a terminal unavailable state after HTTP %s and recovers on retry',
    async (status) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('', { status, headers: { 'Retry-After': '30' } })
      );
      const states: FriendsLookupState[] = [];
      await runFriendsLookup(10, [1], (state) => states.push(state));
      expect(states.map((state) => state.status)).toEqual(['loading', 'unavailable']);
      if (status === 429) {
        expect(states[1]).toMatchObject({ retryAt: Date.now() + 30_000 });
        await runFriendsLookup(10, [1], () => {});
        expect(fetch).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(30_000);
      }
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({ matches: { 1: [friend] }, partial: false })
      );
      const retried: FriendsLookupState[] = [];
      await runFriendsLookup(10, [1], (state) => retried.push(state));
      expect(retried).toEqual([
        { status: 'loading' },
        { status: 'ready', result: { matches: { 1: [friend] }, partial: false } },
      ]);
    }
  );
  it('shows You on another person’s list and hides You on your own without changing shared cached results', async () => {
    const me = { ...friend, id: 10, name: 'Me', isViewer: true };
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ matches: { 1: [me, friend] }, partial: false })
    );
    const result = await loadFriendsWatching(10, [1]);
    expect(withoutListOwner(result.matches, 'FRIEND')[1]).toEqual([me]);
    expect(withoutListOwner(result.matches, 'ME')[1]).toEqual([friend]);
    expect((await loadFriendsWatching(10, [1])).matches[1]).toEqual([me, friend]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('excludes the viewed list owner case-insensitively without changing cached matches for other lists', async () => {
    const result = await loadFriendsWatching(10, [1]);
    expect(withoutListOwner(result.matches, 'FRIEND')[1]).toEqual([]);
    expect(withoutListOwner(result.matches, 'SomeoneElse')[1]).toEqual([friend]);
    expect((await loadFriendsWatching(10, [1])).matches[1]).toEqual([friend]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('batches all cards, caches empty matches, and requests only missing media', async () => {
    await loadFriendsWatching(10, [2, 1, 1]);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
      mediaIds: [1, 2],
    });
    expect(await loadFriendsWatching(10, [2])).toEqual({ matches: { 2: [] }, partial: false });
    await loadFriendsWatching(10, [1, 2, 3]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual({
      mediaIds: [3],
    });
  });
  it('coalesces identical concurrent requests', async () => {
    await Promise.all([loadFriendsWatching(10, [1, 2]), loadFriendsWatching(10, [2, 1])]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('expires results after five minutes', async () => {
    await loadFriendsWatching(10, [1]);
    vi.advanceTimersByTime(299_999);
    await loadFriendsWatching(10, [1]);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await loadFriendsWatching(10, [1]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('retains partial results without treating absent matches as complete', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ matches: { 1: [friend] }, partial: true })
    );
    expect((await loadFriendsWatching(10, [1, 2])).partial).toBe(true);
    await loadFriendsWatching(10, [1, 2]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await loadFriendsWatching(10, [2]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('isolates accounts and clears cache on logout', async () => {
    await loadFriendsWatching(10, [1]);
    await loadFriendsWatching(11, [1]);
    setFriendsViewer(null);
    await loadFriendsWatching(11, [1]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('rejects obsolete responses after switching accounts', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const pending = loadFriendsWatching(10, [1]);
    setFriendsViewer(11);
    resolve(Response.json({ matches: { 1: [friend] }, partial: false }));
    await expect(pending).rejects.toThrow('Account changed');
  });
  it('respects upstream Retry-After without sending another request', async () => {
    vi.mocked(fetch).mockImplementation(
      async () => new Response('', { status: 429, headers: { 'Retry-After': '30' } })
    );
    await expect(loadFriendsWatching(10, [1])).rejects.toThrow();
    await expect(loadFriendsWatching(10, [1])).rejects.toThrow('Please wait');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    await expect(loadFriendsWatching(10, [1])).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('reuses an own list from the main page, including confirmed saves', async () => {
    seedOwnAnime(10, [{ id: 1, title: 'Anime', isAdult: false }]);
    expect(await getOwnSharedAnime(10)).toHaveLength(1);
    await loadFriendsWatching(10, [1]);
    seedOwnAnime(10, []);
    expect(await getOwnSharedAnime(10)).toEqual([]);
    await loadFriendsWatching(10, [1]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not treat a mature-filtered own list as complete when preferences change', async () => {
    seedOwnAnime(10, [], false);
    expect(await getOwnSharedAnime(10, false)).toEqual([]);
    vi.mocked(fetch).mockResolvedValue(Response.json([{ id: 2, title: 'Mature', isAdult: true }]));
    expect(await getOwnSharedAnime(10, true)).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not send requests for an empty list', async () => {
    expect(await loadFriendsWatching(10, [])).toEqual({ matches: {}, partial: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
