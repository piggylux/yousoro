import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListRateLimitError,
  getSequels,
  type AniListSequel,
} from '#lib/server/anilist-client.js';
import { getListStatuses } from '#lib/server/myanimelist-client.js';
import { findSequels, MAX_SEQUELS, nextSequels } from '#lib/server/sequels.js';
import type { MalSession, Session } from '#lib/server/session.js';

import { GET } from '../../routes/api/sequels/[domain]/[mediaId]/+server.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/rate-limit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/rate-limit.js')>()),
  takeClientLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getSequels: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  getListStatuses: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-auth.js', () => ({
  withMalToken: (event: { locals: App.Locals }, use: (token: string) => Promise<unknown>) =>
    use(event.locals.malSession!.token),
}));

const user = { id: 12, name: 'Fixture', avatarUrl: null };
const aniList: Session = { token: 'anilist.token.jwt', user };
const mal: MalSession = { token: 'mal-token', refreshToken: 'r', expiresAt: Infinity, user };

function sequel(id: number, changes: Partial<AniListSequel> = {}): AniListSequel {
  return {
    id,
    malId: id + 1000,
    title: `Anime ${id}`,
    englishTitle: null,
    coverUrl: null,
    isAdult: false,
    status: 'FINISHED',
    format: 'TV',
    episodes: 12,
    startDate: { year: 2020, month: null, day: null },
    listStatus: null,
    ...changes,
  };
}

function event(
  {
    session = null,
    malSession = null,
  }: { session?: Session | null; malSession?: MalSession | null },
  params = { domain: 'anilist', mediaId: '9' }
) {
  return {
    params,
    locals: { session, malSession } as App.Locals,
    cookies: { get: () => undefined, delete: vi.fn() } as unknown as Cookies,
    getClientAddress: () => '127.0.0.1',
  };
}

const read = (request: ReturnType<typeof event>) =>
  GET(request as unknown as Parameters<typeof GET>[0]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('nextSequels', () => {
  it('offers sequels out already that are not on the list, or only planned, to start', () => {
    const offered = nextSequels(
      [
        sequel(1),
        sequel(2, { listStatus: 'PLANNING' }),
        sequel(3, { listStatus: 'CURRENT' }),
        sequel(4, { listStatus: 'COMPLETED' }),
        sequel(5, { listStatus: 'PAUSED' }),
        sequel(6, { listStatus: 'DROPPED' }),
        sequel(7, { listStatus: 'REPEATING' }),
        sequel(9, { status: 'CANCELLED' }),
      ],
      'anilist'
    );

    expect(offered.map(({ id, planned }) => [id, planned])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(offered[0]).not.toHaveProperty('listStatus');
  });

  it('offers announced sequels to plan, after the ones out, unless they are on the list', () => {
    const announced = (id: number, changes: Partial<AniListSequel> = {}) =>
      sequel(id, { status: 'NOT_YET_RELEASED', ...changes });

    const offered = nextSequels(
      [
        announced(1, { startDate: { year: 2027, month: 4, day: null } }),
        announced(2, { listStatus: 'PLANNING' }),
        announced(3, { listStatus: 'CURRENT' }),
        announced(4, { startDate: { year: 2027, month: 1, day: 10 } }),
        sequel(5, { listStatus: 'PLANNING' }),
      ],
      'anilist'
    );

    // The ones out first; the announced ones by when they start
    expect(offered.map(({ id, status }) => [id, status])).toEqual([
      [5, 'FINISHED'],
      [4, 'NOT_YET_RELEASED'],
      [1, 'NOT_YET_RELEASED'],
    ]);
  });

  it('offers adult sequels too, as the user just finished what they continue', () => {
    expect(nextSequels([sequel(1, { isAdult: true })], 'anilist')).toEqual([
      expect.objectContaining({ id: 1, isAdult: true }),
    ]);
  });

  it('puts the next series part first, then the rest in airing order, up to a few', () => {
    const offered = nextSequels(
      [
        sequel(1, { format: 'MOVIE', startDate: { year: 2021, month: null, day: null } }),
        sequel(2, { format: 'OVA', startDate: { year: null, month: null, day: null } }),
        sequel(3, { format: 'TV', startDate: { year: 2023, month: null, day: null } }),
        sequel(4, { format: 'SPECIAL', startDate: { year: 2020, month: null, day: null } }),
        sequel(5, {
          format: 'ONA',
          startDate: { year: 2022, month: null, day: null },
          status: 'RELEASING',
        }),
      ],
      'anilist'
    );

    expect(offered).toHaveLength(MAX_SEQUELS);
    expect(offered.map(({ id }) => id)).toEqual([5, 3, 4]);
  });

  it('only offers a MyAnimeList list the sequels MyAnimeList knows', () => {
    const sequels = [sequel(1, { malId: null }), sequel(2)];

    expect(nextSequels(sequels, 'myanimelist').map(({ id }) => id)).toEqual([2]);
    expect(nextSequels(sequels, 'anilist').map(({ id }) => id)).toEqual([1, 2]);
  });
});

describe('findSequels', () => {
  it("asks AniList as the viewer, which says where each is on the viewer's list", async () => {
    vi.mocked(getSequels).mockResolvedValue([sequel(1, { listStatus: 'COMPLETED' }), sequel(2)]);

    const offered = await findSequels(event({ session: aniList }), 'anilist', 9);

    expect(offered.map(({ id }) => id)).toEqual([2]);
    expect(getSequels).toHaveBeenCalledWith(9, aniList.token);
    expect(getListStatuses).not.toHaveBeenCalled();
  });

  it('asks MyAnimeList where the sequels that could be offered are on a MyAnimeList list', async () => {
    vi.mocked(getSequels).mockResolvedValue([
      sequel(1),
      sequel(2),
      sequel(3, { malId: null }),
      sequel(4, { status: 'NOT_YET_RELEASED' }),
      sequel(5),
    ]);
    vi.mocked(getListStatuses).mockResolvedValue(
      new Map([
        [1001, 'COMPLETED'],
        [1002, 'PLANNING'],
        [1004, null],
      ])
    );

    const offered = await findSequels(event({ malSession: mal }), 'myanimelist', 9);

    // Anonymously on AniList, whose list status would be another account's
    expect(getSequels).toHaveBeenCalledWith(9);
    // The announced one after the ones out
    expect(getListStatuses).toHaveBeenCalledWith('mal-token', [1001, 1002, 1005, 1004]);
    // One MyAnimeList couldn't say anything about isn't offered
    expect(offered.map(({ id, planned }) => [id, planned])).toEqual([
      [2, true],
      [4, false],
    ]);
  });

  it("doesn't ask MyAnimeList when nothing could be offered", async () => {
    vi.mocked(getSequels).mockResolvedValue([sequel(1, { malId: null })]);

    expect(await findSequels(event({ malSession: mal }), 'myanimelist', 9)).toEqual([]);
    expect(getListStatuses).not.toHaveBeenCalled();
  });
});

describe('GET /api/sequels', () => {
  it('answers the signed-in owner with the sequels to offer', async () => {
    vi.mocked(getSequels).mockResolvedValue([sequel(2)]);

    const response = await read(event({ session: aniList }));

    expect(await response.json()).toEqual({
      sequels: [expect.objectContaining({ id: 2, planned: false })],
    });
  });

  it("needs a sign-in on the list's own service", async () => {
    await expect(
      read(event({ session: aniList }, { domain: 'myanimelist', mediaId: '9' }))
    ).rejects.toMatchObject({ status: 401 });
    expect(getSequels).not.toHaveBeenCalled();
  });

  it.each([
    [{ domain: 'kitsu', mediaId: '9' }, 404],
    [{ domain: 'anilist', mediaId: '0' }, 400],
    [{ domain: 'anilist', mediaId: '1.5' }, 400],
    [{ domain: 'anilist', mediaId: '9999999999' }, 400],
  ])('turns away %o with %i', async (params, status) => {
    await expect(read(event({ session: aniList }, params))).rejects.toMatchObject({ status });
  });

  it('says when AniList is busy, with when to try again', async () => {
    vi.mocked(getSequels).mockRejectedValue(new AniListRateLimitError(30));
    const request = event({ session: aniList });

    await expect(read(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(30);
  });
});
