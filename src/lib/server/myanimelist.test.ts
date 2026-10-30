import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLatestAirings, getMediaByMalIds } from '#lib/server/anilist-client.js';
import { getWatchingEntries, type MalEntry } from '#lib/server/myanimelist-client.js';
import { MyAnimeListApi } from '#lib/server/myanimelist.js';

vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getMediaByMalIds: vi.fn(),
  getLatestAirings: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', () => ({ getWatchingEntries: vi.fn() }));

function entry(id: number, progress: number, rewatching = false): MalEntry {
  return {
    node: { id, title: `MAL title ${id}` },
    list_status: {
      status: rewatching ? 'completed' : 'watching',
      score: 7,
      num_episodes_watched: progress,
      is_rewatching: rewatching,
      updated_at: '2026-10-30T10:00:00+00:00',
    },
  };
}

function media(id: number, idMal: number) {
  return {
    id,
    idMal,
    title: { romaji: `AniList title ${id}`, english: null },
    synonyms: null,
    status: 'RELEASING' as const,
    episodes: 12,
    coverImage: { extraLarge: `https://s4.anilist.co/${id}.jpg` },
    endDate: { year: null, month: null, day: null },
    nextAiringEpisode: { episode: 5, airingAt: 2_000_000_000 },
    isAdult: false,
    meanScore: 80,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLatestAirings).mockResolvedValue(new Map());
});

describe('MyAnimeListApi', () => {
  it('takes progress from MyAnimeList and everything else from AniList', async () => {
    vi.mocked(getWatchingEntries).mockResolvedValue([entry(52991, 2), entry(5114, 3, true)]);
    vi.mocked(getMediaByMalIds).mockResolvedValue(
      new Map([
        [52991, media(154587, 52991)],
        [5114, media(5114, 5114)],
      ])
    );

    const list = await new MyAnimeListApi().getUserAnimeList('Fixture', false);

    expect(list).toMatchObject({
      userId: null,
      username: 'Fixture',
      avatarUrl: null,
      scoreFormat: 'POINT_10',
      unmatched: [],
    });
    expect(list.animeList[0]).toMatchObject({
      id: 154587,
      malId: 52991,
      title: 'AniList title 154587',
      currentEpisode: 2,
      userScore: 7,
      rewatching: false,
      numberAiredEpisodes: 4,
      nextEpisode: { number: 5, airsAt: 2_000_000_000_000 },
      lastUpdatedAt: Date.parse('2026-10-30T10:00:00+00:00'),
    });
    expect(list.animeList[1]).toMatchObject({ id: 5114, rewatching: true });
    expect(getWatchingEntries).toHaveBeenCalledWith('Fixture', undefined);
  });

  it("lists anime AniList doesn't know apart, and shows a shared AniList anime once", async () => {
    vi.mocked(getWatchingEntries).mockResolvedValue([entry(1, 1), entry(2, 1), entry(3, 1)]);
    vi.mocked(getMediaByMalIds).mockResolvedValue(
      new Map([
        [1, media(10, 1)],
        [2, media(10, 2)],
      ])
    );

    const list = await new MyAnimeListApi().getUserAnimeList('Fixture', false);

    expect(list.animeList.map((anime) => anime.id)).toEqual([10]);
    expect(list.unmatched).toEqual([{ malId: 3, title: 'MAL title 3', isAdult: false }]);
  });

  it('reads the signed-in owner’s list with their token and names them', async () => {
    vi.mocked(getWatchingEntries).mockResolvedValue([]);
    vi.mocked(getMediaByMalIds).mockResolvedValue(new Map());
    const owner = { id: 12, name: 'Fixture', avatarUrl: 'https://cdn.myanimelist.net/a.jpg' };

    const list = await new MyAnimeListApi({ token: 'token', owner }).getUserAnimeList('fixture');

    expect(getWatchingEntries).toHaveBeenCalledWith('fixture', 'token');
    expect(list).toMatchObject({ userId: 12, username: 'Fixture', avatarUrl: owner.avatarUrl });
  });

  it('marks new episodes from AniList airings', async () => {
    vi.mocked(getWatchingEntries).mockResolvedValue([entry(52991, 2)]);
    vi.mocked(getMediaByMalIds).mockResolvedValue(new Map([[52991, media(154587, 52991)]]));
    vi.mocked(getLatestAirings).mockResolvedValue(new Map([[154587, 1_900_000_000]]));

    const list = await new MyAnimeListApi().getUserAnimeList('Fixture');

    expect(getLatestAirings).toHaveBeenCalledWith([154587], expect.any(Number));
    expect(list.animeList[0].recentEpisodeAiredAt).toBe(1_900_000_000_000);
  });
});
