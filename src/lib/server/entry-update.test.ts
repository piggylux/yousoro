import { describe, expect, it } from 'vitest';

import { parseEntryUpdate } from '#lib/server/entry-update.js';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe('parseEntryUpdate', () => {
  it('reads an episode count alone, as the +1 button sends it', () => {
    expect(parseEntryUpdate(form({ mediaId: '7', progress: '3' }))).toEqual({
      mediaId: 7,
      changes: { progress: 3 },
    });
  });

  it('reads a score alone, as the score prompt sends it', () => {
    expect(
      parseEntryUpdate(form({ mediaId: '7', score: '8.5', scoreFormat: 'POINT_10_DECIMAL' }))
    ).toEqual({ mediaId: 7, changes: { score: 8.5 } });
  });

  it("reads both, as the card's back sends them", () => {
    expect(
      parseEntryUpdate(form({ mediaId: '7', progress: '12', score: '4', scoreFormat: 'POINT_5' }))
    ).toEqual({ mediaId: 7, changes: { progress: 12, score: 4 } });
  });

  it('takes an empty score field as no score', () => {
    expect(
      parseEntryUpdate(form({ mediaId: '7', progress: '2', score: '', scoreFormat: 'POINT_100' }))
    ).toEqual({ mediaId: 7, changes: { progress: 2, score: 0 } });
  });

  it.each([
    ['no anime', { progress: '3' }, 'Unknown anime'],
    ['a bad episode count', { mediaId: '7', progress: '2.5' }, 'Invalid episode count'],
    [
      'a score outside the format',
      { mediaId: '7', score: '11', scoreFormat: 'POINT_10' },
      "That score doesn't fit your AniList scoring system",
    ],
    [
      'an unknown score format',
      { mediaId: '7', score: '8', scoreFormat: 'POINT_7' },
      "That score doesn't fit your AniList scoring system",
    ],
    ['nothing to change', { mediaId: '7' }, 'Nothing to update'],
  ])('refuses %s', (_, fields, message) => {
    expect(parseEntryUpdate(form(fields))).toEqual({ message });
  });

  describe('on MyAnimeList', () => {
    it("needs the anime's MyAnimeList id, and passes it on", () => {
      expect(parseEntryUpdate(form({ mediaId: '7', progress: '3' }), 'myanimelist')).toEqual({
        message: 'Unknown anime',
      });
      expect(
        parseEntryUpdate(form({ mediaId: '7', malId: '52991', progress: '3' }), 'myanimelist')
      ).toEqual({ mediaId: 7, malId: 52991, changes: { progress: 3 } });
    });

    it('reads scores as whole numbers out of 10, whatever format the form names', () => {
      const fields = { mediaId: '7', malId: '1', scoreFormat: 'POINT_100' };
      expect(parseEntryUpdate(form({ ...fields, score: '8' }), 'myanimelist')).toEqual({
        mediaId: 7,
        malId: 1,
        changes: { score: 8 },
      });
      expect(parseEntryUpdate(form({ ...fields, score: '85' }), 'myanimelist')).toEqual({
        message: "That score doesn't fit your MyAnimeList scoring system",
      });
    });
  });
});
