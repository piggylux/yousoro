import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListRateLimitError,
  getAllListEntries,
  getMediaByMalIds,
  saveEntries,
  type AniListListEntry,
  type AniListMedia,
} from '#lib/server/anilist-client.js';
import {
  copyEntry,
  getAllEntries,
  MalNotFoundError,
  MalTokenError,
  type MalEntry,
} from '#lib/server/myanimelist-client.js';
import type { MalSession, Session } from '#lib/server/session.js';
import { applySyncChanges, getSyncPlan, parseSyncChanges } from '#lib/server/sync.js';
import type { SyncChange } from '#lib/sync.js';
import type { Domain } from '#lib/types/domain.js';

vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getAllListEntries: vi.fn(),
  getMediaByMalIds: vi.fn(),
  saveEntries: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  getAllEntries: vi.fn(),
  copyEntry: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-auth.js', () => ({
  withMalToken: (event: { locals: App.Locals }, use: (token: string) => Promise<unknown>) =>
    use(event.locals.malSession!.token),
}));

const user = { id: 40, name: 'Fixture', avatarUrl: null };
const deleted: string[] = [];
const event = {
  cookies: { delete: (name: string) => void deleted.push(name) } as unknown as Cookies,
  locals: {
    session: { token: 'anilist.token.jwt', user } satisfies Session,
    malSession: { token: 'mal-token', refreshToken: 'r', expiresAt: Infinity, user } as MalSession,
  } as App.Locals,
};

function aniList(
  id: number,
  idMal: number | null,
  status: string,
  progress: number,
  updatedAt = 100
): AniListListEntry {
  return {
    status,
    progress,
    score: 80,
    updatedAt,
    startedAt: { year: 2026, month: 9, day: 1 },
    completedAt: status === 'COMPLETED' ? { year: 2026, month: 10, day: null } : null,
    media: {
      id,
      idMal,
      title: { romaji: `Anime ${id}` },
      coverImage: { extraLarge: `https://s4.anilist.co/${id}.jpg` },
      isAdult: false,
    },
  };
}

function mal(id: number, status: string, progress: number, updatedAt: string): MalEntry {
  return {
    node: {
      id,
      title: `MAL ${id}`,
      main_picture: { medium: '', large: `https://cdn.myanimelist.net/${id}.jpg` },
    },
    list_status: {
      status: status as MalEntry['list_status']['status'],
      score: 8,
      num_episodes_watched: progress,
      is_rewatching: false,
      updated_at: updatedAt,
      start_date: '2026-09-01',
      ...(status === 'completed' && { finish_date: '2026-10' }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  deleted.length = 0;
  vi.mocked(saveEntries).mockResolvedValue();
  vi.mocked(copyEntry).mockResolvedValue();
});

describe('getSyncPlan', () => {
  it('compares both whole lists, every anime in any status, by MyAnimeList id', async () => {
    vi.mocked(getAllListEntries).mockResolvedValue([
      // The same on both: left out
      aniList(1, 101, 'COMPLETED', 12),
      // Finished on MyAnimeList since: copied to AniList
      aniList(2, 102, 'CURRENT', 6),
      // Planned on AniList only: added to MyAnimeList
      aniList(3, 103, 'PLANNING', 0),
      // Not on MyAnimeList at all
      aniList(4, null, 'COMPLETED', 1),
    ]);
    vi.mocked(getAllEntries).mockResolvedValue([
      mal(101, 'completed', 12, '1970-01-01T00:00:00Z'),
      mal(102, 'completed', 12, '2026-10-30T00:00:00Z'),
      // On MyAnimeList only: shown as it is there, found on AniList once it's synced
      mal(105, 'dropped', 2, '2026-10-30T00:00:00Z'),
    ]);

    const plan = await getSyncPlan(event);

    expect(plan.items.map(({ malId, to }) => [malId, to])).toEqual([
      [102, 'anilist'],
      [103, 'myanimelist'],
      [105, 'anilist'],
    ]);
    expect(plan.items[0].myanimelist).toMatchObject({ status: 'COMPLETED', progress: 12 });
    // Dates read the same way from both, as far as they're known
    expect(plan.items[0].anilist).toMatchObject({ startedAt: '2026-09-01', completedAt: null });
    expect(plan.items[0].myanimelist).toMatchObject({
      startedAt: '2026-09-01',
      completedAt: '2026-10',
    });
    expect(plan.items[2]).toMatchObject({
      mediaId: null,
      title: 'MAL 105',
      coverUrl: 'https://cdn.myanimelist.net/105.jpg',
      anilist: null,
    });
    expect(plan.unmatched).toEqual(['Anime 4']);
    // By id, as the name saved at sign-in may have changed since; no lookups before syncing
    expect(getAllListEntries).toHaveBeenCalledWith(40, 'anilist.token.jwt');
    expect(getMediaByMalIds).not.toHaveBeenCalled();
  });
});

describe('parseSyncChanges', () => {
  const change = {
    mediaId: 1,
    malId: 11,
    to: 'myanimelist',
    entry: { status: 'COMPLETED', progress: 12, score100: 85 },
  };

  it('reads up to ten changes', () => {
    expect(parseSyncChanges([change])).toEqual([
      {
        ...change,
        entry: { ...change.entry, startedAt: null, completedAt: null, updatedAt: null },
      },
    ]);
    expect(parseSyncChanges(Array(10).fill(change))).toHaveLength(10);
    expect(parseSyncChanges(Array(11).fill(change))).toBeNull();
  });

  it('reads dates as far as they’re known, and refuses others', () => {
    const dated = (startedAt: unknown) => [{ ...change, entry: { ...change.entry, startedAt } }];
    expect(parseSyncChanges(dated('2026-10'))?.[0].entry.startedAt).toBe('2026-10');
    expect(parseSyncChanges(dated('Oct 1'))).toBeNull();
  });

  it('reads an anime whose AniList id isn’t known yet', () => {
    expect(parseSyncChanges([{ ...change, mediaId: null }])?.[0].mediaId).toBeNull();
  });

  it.each([
    ['an unknown service', { ...change, to: 'kitsu' }],
    ['an unknown status', { ...change, entry: { ...change.entry, status: 'DELETED' } }],
    ['a score over 100', { ...change, entry: { ...change.entry, score100: 101 } }],
    ['a negative episode count', { ...change, entry: { ...change.entry, progress: -1 } }],
    ['a missing MyAnimeList id', { ...change, malId: undefined }],
    ['an id of 0', { ...change, malId: 0 }],
  ])('refuses %s', (_, value) => {
    expect(parseSyncChanges([value])).toBeNull();
  });
});

describe('applySyncChanges', () => {
  function change(malId: number, to: Domain, mediaId: number | null = malId - 100): SyncChange {
    return {
      mediaId,
      malId,
      to,
      entry: {
        status: 'REPEATING',
        progress: 3,
        score100: 85,
        startedAt: '2026-09-01',
        completedAt: null,
        updatedAt: null,
      },
    };
  }
  const changes = [change(101, 'anilist'), change(102, 'myanimelist'), change(103, 'anilist')];

  it('saves every AniList change in one request, and MyAnimeList’s one by one', async () => {
    expect(await applySyncChanges(event, changes)).toEqual({ results: [true, true, true] });

    expect(saveEntries).toHaveBeenCalledTimes(1);
    expect(saveEntries).toHaveBeenCalledWith(
      'anilist.token.jwt',
      [
        {
          mediaId: 1,
          progress: 3,
          status: 'REPEATING',
          scoreRaw: 85,
          startedAt: '2026-09-01',
          completedAt: null,
        },
        {
          mediaId: 3,
          progress: 3,
          status: 'REPEATING',
          scoreRaw: 85,
          startedAt: '2026-09-01',
          completedAt: null,
        },
      ],
      'optional'
    );
    // In MyAnimeList's whole numbers, without the read that counting a rewatch takes
    expect(copyEntry).toHaveBeenCalledWith(
      'mal-token',
      102,
      {
        progress: 3,
        status: 'REPEATING',
        score: 9,
        startedAt: '2026-09-01',
        completedAt: null,
      },
      { countRewatch: false, priority: 'optional' }
    );
  });

  it('finds anime only on MyAnimeList’s list on AniList, in one request', async () => {
    vi.mocked(getMediaByMalIds).mockResolvedValue(new Map([[201, { id: 9 } as AniListMedia]]));

    const outcome = await applySyncChanges(event, [
      change(201, 'anilist', null),
      change(202, 'anilist', null),
    ]);

    expect(getMediaByMalIds).toHaveBeenCalledWith([201, 202], 'optional');
    expect(saveEntries).toHaveBeenCalledWith(
      'anilist.token.jwt',
      [expect.objectContaining({ mediaId: 9 })],
      'optional'
    );
    expect(outcome.results).toEqual([true, "AniList doesn't have this anime"]);
  });

  it('leaves a busy service’s changes for later while the other’s go ahead', async () => {
    vi.mocked(saveEntries).mockRejectedValue(new AniListRateLimitError(30));

    expect(await applySyncChanges(event, changes)).toEqual({
      results: [null, true, null],
      busy: { service: 'AniList', retryAfter: 30 },
    });
  });

  it('finds the change AniList refuses by trying each on its own', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(saveEntries)
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('refused'));

    expect((await applySyncChanges(event, changes)).results).toEqual([
      true,
      true,
      "Couldn't update",
    ]);
    expect(saveEntries).toHaveBeenCalledTimes(3);
  });

  it('says when MyAnimeList doesn’t have an anime', async () => {
    vi.mocked(copyEntry).mockRejectedValue(new MalNotFoundError('gone'));

    expect((await applySyncChanges(event, [change(102, 'myanimelist')])).results).toEqual([
      "MyAnimeList doesn't have this anime",
    ]);
  });

  it("stops and signs out of a service whose sign-in can't be renewed", async () => {
    vi.mocked(copyEntry).mockRejectedValue(new MalTokenError('expired'));

    const outcome = await applySyncChanges(event, changes);

    expect(outcome.results).toEqual([true, null, true]);
    expect(outcome.stopped).toContain('MyAnimeList sign-in expired');
    expect(deleted).toEqual(['session_mal']);
  });
});
