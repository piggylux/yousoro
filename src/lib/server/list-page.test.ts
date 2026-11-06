import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLatestAirings,
  getMediaByMalIds,
  getPlanningEntries,
  getWatchingEntries as getAniListWatching,
} from '#lib/server/anilist-client.js';
import { loadAnimePage, loadPlanningPage, saveTarget } from '#lib/server/list-page.js';
import {
  getPlanToWatchEntries,
  getWatchingEntries as getMalWatching,
  MalRateLimitError,
  type MalEntry,
} from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import type { MalSession, Session } from '#lib/server/session.js';
import type { Domain } from '#lib/types/domain.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/rate-limit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/rate-limit.js')>()),
  takeClientLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getWatchingEntries: vi.fn(),
  getPlanningEntries: vi.fn(),
  getMediaByMalIds: vi.fn(),
  getLatestAirings: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  getWatchingEntries: vi.fn(),
  getPlanToWatchEntries: vi.fn(),
}));

const aniUser = { id: 1, name: 'Viewer', avatarUrl: 'https://s4.anilist.co/viewer.png' };
const malUser = { id: 2, name: 'ViewerMal', avatarUrl: null };
const aniListSession: Session = { token: 'anilist-token', user: aniUser };
const malSession: MalSession = {
  token: 'mal-token',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3_600_000,
  user: malUser,
};

function media(id: number, idMal: number | null) {
  return {
    id,
    idMal,
    title: { romaji: `Anime ${id}`, english: null },
    synonyms: null,
    status: 'RELEASING' as const,
    episodes: 12,
    coverImage: { extraLarge: '' },
    endDate: { year: null, month: null, day: null },
    nextAiringEpisode: { episode: 9, airingAt: 2_000_000_000 },
    isAdult: false,
    meanScore: 80,
  };
}

function aniListEntry(id: number, idMal: number | null, progress: number) {
  return { media: media(id, idMal), status: 'CURRENT', progress, score: 80, updatedAt: 100 };
}

function malEntry(id: number, progress: number): MalEntry {
  return {
    node: { id, title: `MAL ${id}` },
    list_status: {
      status: 'watching',
      score: 7,
      num_episodes_watched: progress,
      is_rewatching: false,
      updated_at: '2026-11-01T00:00:00+00:00',
    },
  };
}

function event(domain: Domain, username: string, mainList: Domain = 'anilist') {
  return {
    params: { domain, username },
    locals: {
      session: aniListSession,
      malSession,
      preferences: { ...DEFAULT_PREFERENCES, mainList },
    } as App.Locals,
    cookies: { get: () => undefined, set: vi.fn(), delete: vi.fn() } as unknown as Cookies,
    isDataRequest: true,
    getClientAddress: () => '127.0.0.1',
    url: new URL(`http://localhost/user/${domain}/${username}`),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLatestAirings).mockResolvedValue(new Map());
  vi.mocked(getAniListWatching).mockResolvedValue({
    userId: 1,
    userName: 'Viewer',
    avatarUrl: aniUser.avatarUrl,
    scoreFormat: 'POINT_100',
    entries: [aniListEntry(10, 110, 3), aniListEntry(20, null, 1)],
  } as never);
  vi.mocked(getMalWatching).mockResolvedValue([malEntry(110, 5), malEntry(130, 2)]);
  vi.mocked(getMediaByMalIds).mockResolvedValue(new Map([[130, media(30, 130)]]) as never);
});

describe('a combined watching list', () => {
  it('reads each service once and only asks AniList about anime its list lacks', async () => {
    const page = await loadAnimePage(event('anilist', 'Viewer'));

    expect(getAniListWatching).toHaveBeenCalledTimes(1);
    expect(getAniListWatching).toHaveBeenCalledWith('Viewer', 'anilist-token', undefined);
    expect(getMalWatching).toHaveBeenCalledTimes(1);
    expect(getMalWatching).toHaveBeenCalledWith('ViewerMal', 'mal-token', undefined);
    expect(getMediaByMalIds).toHaveBeenCalledTimes(1);
    expect(getMediaByMalIds).toHaveBeenCalledWith([130], undefined);
    // Airings are looked up once, for both lists
    expect(getLatestAirings).toHaveBeenCalledTimes(1);
    expect(takeClientLimit).toHaveBeenCalledWith('127.0.0.1', 'read', 3);

    expect(page).toMatchObject({
      domain: 'anilist',
      canEdit: true,
      scoreFormat: 'POINT_100',
      combined: { aniListName: 'Viewer', otherScoreFormat: 'POINT_10' },
    });
    if ('unavailable' in page) throw new Error('The list should be there');
    expect(
      page.watchingList.map(({ id, currentEpisode, userScore, onlyOn }) => ({
        id,
        currentEpisode,
        userScore,
        onlyOn,
      }))
    ).toEqual([
      { id: 10, currentEpisode: 5, userScore: 80, onlyOn: undefined },
      { id: 20, currentEpisode: 1, userScore: 80, onlyOn: 'anilist' },
      { id: 30, currentEpisode: 2, userScore: 7, onlyOn: 'myanimelist' },
    ]);
  });

  it("doesn't ask AniList about anything when both lists have the same anime", async () => {
    vi.mocked(getMalWatching).mockResolvedValue([malEntry(110, 3)]);

    await loadAnimePage(event('anilist', 'Viewer'));

    expect(getMediaByMalIds).not.toHaveBeenCalled();
  });

  it('shows the main list alone, saying why, when the other service is busy', async () => {
    vi.mocked(getMalWatching).mockRejectedValue(new MalRateLimitError(30));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const page = await loadAnimePage(event('anilist', 'Viewer'));

    expect(page).toMatchObject({
      combined: { partial: "Showing your AniList list only: MyAnimeList didn't answer." },
    });
    if ('unavailable' in page) throw new Error('The list should be there');
    expect(page.watchingList.map(({ id }) => id)).toEqual([10, 20]);
  });

  it("is on the main list's service, with its owner, scores and edit rights", async () => {
    const page = await loadAnimePage(event('myanimelist', 'ViewerMal', 'myanimelist'));

    expect(page).toMatchObject({
      domain: 'myanimelist',
      username: 'ViewerMal',
      canEdit: true,
      scoreFormat: 'POINT_10',
      combined: { aniListName: 'Viewer', otherScoreFormat: 'POINT_100' },
    });
  });

  it("leaves anyone else's list as it is", async () => {
    await loadAnimePage(event('anilist', 'Someone'));

    expect(getMalWatching).not.toHaveBeenCalled();
    expect(takeClientLimit).toHaveBeenCalledWith('127.0.0.1', 'read', 2);
  });
});

describe('a combined plan list', () => {
  it('reads each service once, without asking AniList about MyAnimeList anime', async () => {
    vi.mocked(getPlanningEntries).mockResolvedValue({
      userId: 1,
      userName: 'Viewer',
      entries: [],
    });
    vi.mocked(getPlanToWatchEntries).mockResolvedValue([
      {
        ...malEntry(140, 0),
        node: { id: 140, title: 'MAL 140', status: 'finished_airing' },
      },
    ]);

    const page = await loadPlanningPage(event('anilist', 'Viewer'));

    expect(getPlanningEntries).toHaveBeenCalledTimes(1);
    expect(getPlanToWatchEntries).toHaveBeenCalledTimes(1);
    expect(getMediaByMalIds).not.toHaveBeenCalled();
    expect(takeClientLimit).toHaveBeenCalledWith('127.0.0.1', 'read', 2);
    expect(page.combined).toEqual({ aniListName: 'Viewer' });
    expect(page.planned).toMatchObject([{ id: null, malId: 140, onlyOn: 'myanimelist' }]);
  });
});

describe('saveTarget', () => {
  const { locals } = event('anilist', 'Viewer');

  it("saves to the list's own service by default", () => {
    expect(saveTarget(locals, 'anilist', 'Viewer', null)).toBe('anilist');
    expect(saveTarget(locals, 'anilist', 'Viewer', 'anilist')).toBe('anilist');
  });

  it('saves to the other service only from a combined list', () => {
    expect(saveTarget(locals, 'anilist', 'Viewer', 'myanimelist')).toBe('myanimelist');
    expect(saveTarget(locals, 'anilist', 'Someone', 'myanimelist')).toBeNull();
    expect(
      saveTarget({ ...locals, malSession: null }, 'anilist', 'Viewer', 'myanimelist')
    ).toBeNull();
    expect(saveTarget(locals, 'anilist', 'Viewer', 'elsewhere')).toBeNull();
  });
});
