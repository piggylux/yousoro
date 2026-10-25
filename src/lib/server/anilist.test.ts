import { afterEach, describe, expect, it, vi } from 'vitest';

import { AniListApi } from '#lib/server/anilist.js';

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

// Answers the list query the way AniList would, with one entry
function answerWith(entryMedia: ReturnType<typeof media>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
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
      })
    )
  );
}

afterEach(() => vi.unstubAllGlobals());

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
});
