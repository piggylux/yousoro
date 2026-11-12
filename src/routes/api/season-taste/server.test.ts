import { isHttpError, type Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  getSeasonTaste,
} from '#lib/server/anilist-client.js';
import { getSeasonTasteEntries, MalForbiddenError } from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import type { MalSession, Session } from '#lib/server/session.js';
import type { SeasonTaste } from '#lib/types/season.js';

import { GET } from './[domain]/[username]/+server.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/rate-limit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/rate-limit.js')>()),
  takeClientLimit: vi.fn(),
}));
vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getSeasonTaste: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  getSeasonTasteEntries: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-auth.js', () => ({
  MAL_ENABLED: true,
  withMalToken: (event: { locals: App.Locals }, use: (token: string) => Promise<unknown>) =>
    use(event.locals.malSession!.token),
}));

const user = { id: 12, name: 'Fixture', avatarUrl: null };
const TASTE: SeasonTaste = {
  scored: 1,
  watched: 1,
  traits: [],
  listedIds: { COMPLETED: [1] },
  watching: [],
  scores: [[1, 80]],
  mean100: 80,
};

function event(
  domain: string,
  {
    session = null,
    malSession = null,
  }: { session?: Session | null; malSession?: MalSession | null } = {}
) {
  return {
    params: { domain, username: 'fixture' },
    locals: { session, malSession } as App.Locals,
    cookies: { get: () => undefined, delete: vi.fn() } as unknown as Cookies,
    getClientAddress: () => '127.0.0.1',
  } as unknown as Parameters<typeof GET>[0];
}

const read = async (request: Parameters<typeof GET>[0]) => (await GET(request)).json();
async function failure(request: Parameters<typeof GET>[0]) {
  try {
    await GET(request);
  } catch (err) {
    if (isHttpError(err)) return err;
    throw err;
  }
  throw new Error('The read succeeded');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getSeasonTaste).mockResolvedValue({ userId: 12, userName: 'Fixture', taste: TASTE });
  vi.mocked(getSeasonTasteEntries).mockResolvedValue([]);
});

describe('the season taste endpoint', () => {
  it("reads an AniList list as the viewer, and says whether it's theirs", async () => {
    const session = { token: 'viewer-token', user };
    expect(await read(event('anilist', { session }))).toEqual({
      ...TASTE,
      domain: 'anilist',
      username: 'Fixture',
      canEdit: true,
    });
    expect(getSeasonTaste).toHaveBeenCalledWith('fixture', 'viewer-token');

    expect(await read(event('anilist'))).toMatchObject({ canEdit: false });
    expect(getSeasonTaste).toHaveBeenLastCalledWith('fixture', undefined);
  });

  it('reads the owner’s own MyAnimeList list with their token', async () => {
    const malSession = { token: 'mal-token', refreshToken: 'r', expiresAt: Infinity, user };
    expect(await read(event('myanimelist', { malSession }))).toMatchObject({
      domain: 'myanimelist',
      username: 'Fixture',
      canEdit: true,
    });
    expect(getSeasonTasteEntries).toHaveBeenCalledWith('fixture', 'mal-token');
  });

  it('turns away a service it doesn’t know', async () => {
    expect((await failure(event('kitsu'))).status).toBe(404);
    expect(getSeasonTaste).not.toHaveBeenCalled();
  });

  it('says when there is no such list, or it is private', async () => {
    vi.mocked(getSeasonTaste).mockRejectedValue(new AniListNotFoundError('Private User'));
    expect((await failure(event('anilist'))).status).toBe(404);

    vi.mocked(getSeasonTasteEntries).mockRejectedValue(new MalForbiddenError('private'));
    expect((await failure(event('myanimelist'))).status).toBe(403);
  });

  it('says when to try again when AniList or this client is busy', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(getSeasonTaste).mockRejectedValue(new AniListRateLimitError(25));
    const busy = await failure(event('anilist'));
    expect(busy.status).toBe(429);
    expect(busy.body).toMatchObject({ retryAt: now + 25_000 });

    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 40 });
    expect((await failure(event('anilist'))).body).toMatchObject({ retryAt: now + 40_000 });
    expect(getSeasonTaste).toHaveBeenCalledTimes(1);
  });
});
