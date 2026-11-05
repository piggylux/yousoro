import { describe, expect, it } from 'vitest';

import { animePageUrl } from '#lib/types/domain.js';

describe('animePageUrl', () => {
  it("links to the anime on the list's own service", () => {
    expect(animePageUrl('anilist', { id: 1, malId: 1001 })).toBe('https://anilist.co/anime/1');
    expect(animePageUrl('myanimelist', { id: 1, malId: 1001 })).toBe(
      'https://myanimelist.net/anime/1001'
    );
  });

  it("links a MyAnimeList list's anime to AniList when MyAnimeList's id isn't known", () => {
    expect(animePageUrl('myanimelist', { id: 1, malId: null })).toBe('https://anilist.co/anime/1');
  });
});
