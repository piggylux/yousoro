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
            user: { id: 7, name: 'Piggylux', avatar: null },
            lists: [
              {
                isCustomList: false,
                entries: [{ status: 'CURRENT', progress: 2, updatedAt: 0, media: entryMedia }],
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

  it('copes with no English title and no synonyms', async () => {
    answerWith(media({ romaji: 'Koupen-chan', english: null }, null));
    const { animeList } = await new AniListApi().getUserAnimeList('Piggylux');
    expect(animeList[0].englishTitle).toBeNull();
    expect(animeList[0].otherTitles).toEqual([]);
  });
});
