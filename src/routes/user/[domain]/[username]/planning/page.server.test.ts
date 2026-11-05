import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMediaByMalIds,
  getPlanningEntries,
  saveEntry,
  type AniListMedia,
} from '#lib/server/anilist-client.js';
import {
  copyEntry,
  getPlanToWatchEntries,
  startWatching,
  type MalEntry,
} from '#lib/server/myanimelist-client.js';
import type { MalSession, Session } from '#lib/server/session.js';
import type { AiringStatus } from '#lib/types/anime.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

import { GET } from '../../../../api/planning/[domain]/[username]/+server.js';
import { actions } from './+page.server.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/rate-limit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/rate-limit.js')>()),
  takeClientLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getPlanningEntries: vi.fn(),
  getMediaByMalIds: vi.fn(),
  saveEntry: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  getPlanToWatchEntries: vi.fn(),
  startWatching: vi.fn(),
  copyEntry: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-auth.js', () => ({
  MAL_ENABLED: true,
  withMalToken: (event: { locals: App.Locals }, use: (token: string) => Promise<unknown>) =>
    use(event.locals.malSession!.token),
}));

const user = { id: 12, name: 'Fixture', avatarUrl: null };
const aniList: Session = { token: 'anilist.token.jwt', user };
const mal: MalSession = { token: 'mal-token', refreshToken: 'r', expiresAt: Infinity, user };
const started = { progress: 0, score: 0, status: 'CURRENT', startedAt: null, completedAt: null };

function event(
  domain: string,
  {
    session = null,
    malSession = null,
  }: { session?: Session | null; malSession?: MalSession | null },
  fields: Record<string, string> = {},
  preferences = DEFAULT_PREFERENCES
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return {
    params: { domain, username: 'Fixture' },
    locals: { session, malSession, preferences } as App.Locals,
    cookies: { get: () => undefined, delete: vi.fn() } as unknown as Cookies,
    request: new Request(`http://localhost/user/${domain}/Fixture/planning?/startWatching`, {
      method: 'POST',
      body: form,
    }),
    getClientAddress: () => '127.0.0.1',
  };
}

const start = (request: ReturnType<typeof event>) =>
  actions.startWatching!(
    request as unknown as Parameters<NonNullable<typeof actions.startWatching>>[0]
  );
const read = async (request: ReturnType<typeof event>) =>
  (await GET(request as unknown as Parameters<typeof GET>[0])).json();

function planned(
  id: number,
  {
    isAdult = false,
    status = 'FINISHED',
    updatedAt = 1_700_000_000,
    // A higher id airs later by default, so a lower-numbered prequel is the earlier part;
    // a null year stands for AniList sending no start date at all
    year = 2000 + id,
    prequels = [],
    sequels = [],
  }: Partial<{
    isAdult: boolean;
    status: AiringStatus;
    updatedAt: number;
    year: number | null;
    prequels: number[];
    sequels: number[];
  }> = {}
) {
  return {
    updatedAt,
    media: {
      id,
      idMal: id + 1000,
      title: { romaji: `Anime ${id}`, english: null },
      status,
      episodes: 12,
      coverImage: { medium: `https://s4.anilist.co/${id}.jpg` },
      isAdult,
      meanScore: 80,
      genres: ['Drama'],
      startDate: year === null ? null : { year, month: 4, day: 1 },
      relations: {
        edges: [
          ...prequels.map((other) => ({ relationType: 'PREQUEL', node: related(other) })),
          ...sequels.map((other) => ({ relationType: 'SEQUEL', node: related(other) })),
        ],
      },
    },
  };
}

/** An anime another links to, with what AniList sends of it: an aired anime by default */
function related(
  id: number,
  changes: Partial<{ status: AiringStatus; isAdult: boolean; title: { romaji: string } }> = {}
) {
  return {
    id,
    type: 'ANIME' as const,
    status: 'FINISHED' as AiringStatus,
    isAdult: false,
    title: { romaji: `Anime ${id}` },
    ...changes,
  };
}

/** What each anime on the page says it is still waiting on, by AniList id */
const prequelsById = (data: { planned: { id: number; prequels: number[] }[] }) =>
  Object.fromEntries(data.planned.map(({ id, prequels }) => [id, prequels]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveEntry).mockResolvedValue(started);
  vi.mocked(startWatching).mockResolvedValue(started);
  vi.mocked(copyEntry).mockResolvedValue();
  vi.mocked(getPlanningEntries).mockResolvedValue({
    userId: 12,
    userName: 'Fixture',
    entries: [planned(1), planned(2, { isAdult: true })],
  });
});

describe('planning list', () => {
  it('lets its owner start its anime, and shows it as AniList has it, adult anime left out', async () => {
    const data = await read(event('anilist', { session: aniList }));

    expect(getPlanningEntries).toHaveBeenCalledWith('Fixture', 'anilist.token.jwt');
    expect(data).toEqual({
      domain: 'anilist',
      username: 'Fixture',
      canEdit: true,
      planned: [
        {
          id: 1,
          malId: 1001,
          title: 'Anime 1',
          englishTitle: null,
          coverUrl: 'https://s4.anilist.co/1.jpg',
          isAdult: false,
          status: 'FINISHED',
          episodes: 12,
          meanScore: 80,
          year: 2001,
          genres: ['Drama'],
          prequels: [],
          sequels: [],
        },
      ],
      upcoming: 0,
      userProfileLink: 'https://anilist.co/user/Fixture/animelist/Planning',
    });
  });

  it("shows anyone else's list without letting them change it", async () => {
    const other = { ...aniList, user: { ...user, id: 99 } };
    const showMature = { ...DEFAULT_PREFERENCES, showMature: true };

    const data = await read(event('anilist', { session: other }, {}, showMature));

    expect(data).toMatchObject({ canEdit: false });
    expect(data.planned).toHaveLength(2);
  });

  it("only counts anime that haven't aired, and lists the rest most recently planned first", async () => {
    vi.mocked(getPlanningEntries).mockResolvedValue({
      userId: 12,
      userName: 'Fixture',
      entries: [
        planned(1, { updatedAt: 100 }),
        planned(2, { status: 'NOT_YET_RELEASED' }),
        planned(3, { status: 'RELEASING', updatedAt: 300 }),
        planned(4, { status: 'NOT_YET_RELEASED' }),
        // Hidden with the viewer's mature setting, so not counted either
        planned(5, { status: 'NOT_YET_RELEASED', isAdult: true }),
        planned(6, { updatedAt: 200 }),
      ],
    });

    const data = await read(event('anilist', { session: aniList }));

    expect(data.planned.map((anime: { id: number }) => anime.id)).toEqual([3, 6, 1]);
    expect(data.upcoming).toBe(2);
  });

  it('reads a MyAnimeList list without asking AniList anything', async () => {
    vi.mocked(getPlanToWatchEntries).mockResolvedValue([
      {
        node: { id: 5114, title: 'Fullmetal Alchemist: Brotherhood', status: 'finished_airing' },
        list_status: { updated_at: '2026-10-30T10:00:00+00:00' },
      } as MalEntry,
    ]);

    const data = await read(event('myanimelist', { malSession: mal }));

    expect(getPlanToWatchEntries).toHaveBeenCalledWith('Fixture', 'mal-token');
    expect(getPlanningEntries).not.toHaveBeenCalled();
    expect(getMediaByMalIds).not.toHaveBeenCalled();
    expect(data).toMatchObject({
      canEdit: true,
      planned: [{ id: null, malId: 5114, prequels: [] }],
      userProfileLink: 'https://myanimelist.net/animelist/Fixture?status=6',
    });
  });

  it('says which earlier parts a sequel is still waiting on, by airing order', async () => {
    vi.mocked(getPlanningEntries).mockResolvedValue({
      userId: 12,
      userName: 'Fixture',
      entries: [
        planned(1, { sequels: [2] }),
        // Anime 3 is a prequel AniList knows by story, made after what it precedes, as Fate/Zero was
        planned(2, { prequels: [1, 3] }),
        planned(3, { year: 2011, sequels: [2] }),
        // A prequel that was never planned, so there is nothing on this page to start first
        planned(4, { prequels: [99] }),
      ],
    });

    const data = await read(event('anilist', { session: aniList }));

    expect(prequelsById(data)).toEqual({ 1: [], 2: [1], 3: [], 4: [] });
  });

  it('leaves out an earlier part nobody can start from this page', async () => {
    vi.mocked(getPlanningEntries).mockResolvedValue({
      userId: 12,
      userName: 'Fixture',
      entries: [
        planned(1, { isAdult: true, sequels: [2] }),
        planned(2, { prequels: [1] }),
        planned(3, { status: 'NOT_YET_RELEASED', sequels: [4] }),
        planned(4, { prequels: [3] }),
      ],
    });

    const data = await read(event('anilist', { session: aniList }));

    expect(prequelsById(data)).toEqual({ 2: [], 4: [] });
  });

  it('leaves an anime ungrouped when AniList is missing the dates or the relations', async () => {
    vi.mocked(getPlanningEntries).mockResolvedValue({
      userId: 12,
      userName: 'Fixture',
      entries: [
        planned(1, { sequels: [2] }),
        // Undated, so there is no telling whether it comes before the anime that continues it
        planned(2, { year: null, sequels: [3] }),
        planned(3, { prequels: [2] }),
        // Undated itself, so nothing can be shown to come before it
        planned(4, { year: null, prequels: [1] }),
        // AniList sent no relations at all, which must cost the grouping rather than the page
        { ...planned(5), media: { ...planned(5).media, relations: null } },
      ],
    });

    const data = await read(event('anilist', { session: aniList }));

    expect(prequelsById(data)).toEqual({ 1: [], 2: [], 3: [], 4: [], 5: [] });
  });

  it('says what follows an anime that the page leaves out, from the same single read', async () => {
    const first = planned(1);
    vi.mocked(getPlanningEntries).mockResolvedValue({
      userId: 12,
      userName: 'Fixture',
      entries: [
        {
          ...first,
          media: {
            ...first.media,
            relations: {
              edges: [
                // Listed itself, as a part of the series
                { relationType: 'SEQUEL', node: related(2) },
                // Planned, but only counted until it airs
                { relationType: 'SEQUEL', node: related(3, { status: 'NOT_YET_RELEASED' }) },
                {
                  relationType: 'SEQUEL',
                  node: related(50, { status: 'RELEASING', title: { romaji: 'Never planned' } }),
                },
                // Hidden by the viewer's mature setting
                { relationType: 'SEQUEL', node: related(51, { isAdult: true }) },
                // AniList can link one twice
                { relationType: 'SEQUEL', node: related(50) },
              ],
            },
          },
        },
        planned(2, { prequels: [1] }),
        planned(3, { status: 'NOT_YET_RELEASED', prequels: [1] }),
      ],
    });

    const data = await read(event('anilist', { session: aniList }));

    expect(data.planned.find((anime: { id: number }) => anime.id === 1)?.sequels).toEqual([
      { id: 3, title: 'Anime 3', status: 'NOT_YET_RELEASED', planned: true },
      { id: 50, title: 'Never planned', status: 'RELEASING', planned: false },
    ]);
    expect(getPlanningEntries).toHaveBeenCalledTimes(1);
  });

  it("says when there's no such user", async () => {
    const { AniListNotFoundError } = await import('#lib/server/anilist-client.js');
    vi.mocked(getPlanningEntries).mockRejectedValue(new AniListNotFoundError('User not found'));

    await expect(read(event('anilist', {}))).rejects.toMatchObject({
      status: 404,
      body: { message: "There's no AniList user named Fixture" },
    });
    await expect(read(event('kitsu', {}))).rejects.toMatchObject({ status: 404 });
  });
});

describe('startWatching', () => {
  it('moves an anime to Watching on AniList in one request, and only that', async () => {
    const result = await start(event('anilist', { session: aniList }, { mediaId: '1' }));

    expect(result).toEqual({ mediaId: 1, malId: undefined, ...started });
    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(saveEntry).toHaveBeenCalledWith('anilist.token.jwt', 1, { status: 'CURRENT' });
    expect(getPlanningEntries).not.toHaveBeenCalled();
    expect(copyEntry).not.toHaveBeenCalled();
  });

  it('copies only the status to a linked MyAnimeList account, whose progress may be ahead', async () => {
    await start(
      event('anilist', { session: aniList, malSession: mal }, { mediaId: '1', malId: '1001' })
    );

    expect(startWatching).toHaveBeenCalledWith('mal-token', 1001);
    expect(copyEntry).not.toHaveBeenCalled();
  });

  it('moves an anime to Watching on MyAnimeList, and on a linked AniList account', async () => {
    vi.mocked(getMediaByMalIds).mockResolvedValue(new Map([[5114, { id: 5114 } as AniListMedia]]));

    const result = await start(
      event('myanimelist', { session: aniList, malSession: mal }, { malId: '5114' })
    );

    expect(result).toMatchObject({ malId: 5114, status: 'CURRENT' });
    expect(result).not.toHaveProperty('linked');
    expect(startWatching).toHaveBeenCalledWith('mal-token', 5114);
    expect(getMediaByMalIds).toHaveBeenCalledWith([5114]);
    expect(saveEntry).toHaveBeenCalledWith('anilist.token.jwt', 5114, { status: 'CURRENT' });
  });

  it('asks the owner to sign in, and turns away a form without the anime', async () => {
    expect(await start(event('anilist', {}, { mediaId: '1' }))).toMatchObject({
      status: 401,
      data: { message: 'Sign in with AniList to update your list' },
    });
    // A MyAnimeList list needs MyAnimeList's id, which its plan lists always have
    expect(await start(event('myanimelist', { malSession: mal }, { mediaId: '1' }))).toMatchObject({
      status: 400,
      data: { message: 'Unknown anime' },
    });
    expect(saveEntry).not.toHaveBeenCalled();
    expect(startWatching).not.toHaveBeenCalled();
  });
});
