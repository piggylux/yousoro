import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { AniListApi } from '#lib/server/anilist.js';

const cacheNamespace = vi.hoisted(() => ({ value: 0 }));
beforeEach(() => {
  cacheNamespace.value++;
});

vi.mock('#lib/server/rate-limit.js', () => ({
  fingerprint: (value: string) => `${cacheNamespace.value}:${value}`,
  takeAniListRequest: async () => ({ allowed: true, retryAfter: 0 }),
  pauseAniList: vi.fn(),
}));

function media(title: { romaji: string; english: string | null }, synonyms: string[] | null) {
  return {
    id: 1,
    title,
    synonyms,
    status: 'RELEASING',
    episodes: 12,
    coverImage: { extraLarge: 'https://s4.anilist.co/cover.jpg' },
    endDate: { year: null, month: null, day: null },
    nextAiringEpisode: { episode: 5, airingAt: 0 },
    isAdult: false,
    meanScore: 78,
  };
}

type Airing = { mediaId: number; airingAt: number };

// Answers the list query the way AniList would, with one entry, and the recent airings query with
// `airings`, or with an error when there are none to give
function answerWith(entryMedia: ReturnType<typeof media>, airings: Airing[] | null = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_: string, init: RequestInit) => {
      const { query } = JSON.parse(init.body as string) as { query: string };
      if (query.includes('airingSchedules')) {
        return airings
          ? Response.json({ data: { Page: { airingSchedules: airings } } })
          : Response.json(
              { data: null, errors: [{ message: 'Too Many Requests' }] },
              { status: 429 }
            );
      }
      return Response.json({
        data: {
          MediaListCollection: {
            user: {
              id: 7,
              name: 'Piggylux',
              avatar: null,
              mediaListOptions: { scoreFormat: 'POINT_10_DECIMAL' },
            },
            lists: [
              {
                isCustomList: false,
                entries: [
                  { status: 'CURRENT', progress: 2, score: 8.5, updatedAt: 0, media: entryMedia },
                ],
              },
            ],
          },
        },
      });
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AniListApi.getUserAnimeList', () => {
  it('gives the English title, and the synonyms other than the main titles', async () => {
    answerWith(
      media({ romaji: 'Kanojo no Tomodachi', english: "My Girlfriend's Friend" }, [
        'Kanojo no Tomodachi',
        "My Girlfriend's Friend",
        'KanoTomo',
      ])
    );
    const { animeList } = await new AniListApi().getUserAnimeList('Piggylux');
    expect(animeList[0].title).toBe('Kanojo no Tomodachi');
    expect(animeList[0].englishTitle).toBe("My Girlfriend's Friend");
    expect(animeList[0].otherTitles).toEqual(['KanoTomo']);
  });

  it("gives the mean score, and the owner's score in their own score format", async () => {
    answerWith(media({ romaji: 'Koupen-chan', english: null }, []));
    const { scoreFormat, animeList } = await new AniListApi().getUserAnimeList('Piggylux');
    expect(scoreFormat).toBe('POINT_10_DECIMAL');
    expect(animeList[0].meanScore).toBe(78);
    expect(animeList[0].userScore).toBe(8.5);
  });

  it('copes with no English title and no synonyms', async () => {
    answerWith(media({ romaji: 'Koupen-chan', english: null }, null));
    const { animeList } = await new AniListApi().getUserAnimeList('Piggylux');
    expect(animeList[0].englishTitle).toBeNull();
    expect(animeList[0].otherTitles).toEqual([]);
  });

  it('gives when the latest episode aired, the newest airing of each anime', async () => {
    answerWith(media({ romaji: 'Koupen-chan', english: null }, []), [
      { mediaId: 1, airingAt: 2000 },
      { mediaId: 1, airingAt: 1000 },
    ]);
    const { animeList } = await new AniListApi().getUserAnimeList('Piggylux');
    expect(animeList[0].recentEpisodeAiredAt).toBe(2_000_000);
  });

  it('gives no air time for an anime that hasn’t aired an episode recently', async () => {
    answerWith(media({ romaji: 'Koupen-chan', english: null }, []), []);
    const { animeList } = await new AniListApi().getUserAnimeList('Piggylux');
    expect(animeList[0].recentEpisodeAiredAt).toBeNull();
  });

  it('still gives the list when AniList fails to give recent airings', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    answerWith(media({ romaji: 'Koupen-chan', english: null }, []), null);
    const { animeList } = await new AniListApi().getUserAnimeList('Piggylux');
    expect(animeList[0].title).toBe('Koupen-chan');
    expect(animeList[0].recentEpisodeAiredAt).toBeNull();
  });
});
