import { describe, expect, it } from 'vitest';

import { parseEntryRevert, parseEntryUpdate } from '#lib/server/entry-update.js';

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
    ).toEqual({ mediaId: 7, changes: { score: 8.5 }, scoreFormat: 'POINT_10_DECIMAL' });
  });

  it("reads both, as the card's back sends them", () => {
    expect(
      parseEntryUpdate(form({ mediaId: '7', progress: '12', score: '4', scoreFormat: 'POINT_5' }))
    ).toEqual({ mediaId: 7, changes: { progress: 12, score: 4 }, scoreFormat: 'POINT_5' });
  });

  it('takes an empty score field as no score', () => {
    expect(
      parseEntryUpdate(form({ mediaId: '7', progress: '2', score: '', scoreFormat: 'POINT_100' }))
    ).toEqual({ mediaId: 7, changes: { progress: 2, score: 0 }, scoreFormat: 'POINT_100' });
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

  it('passes on how many episodes the card says the anime has', () => {
    expect(parseEntryUpdate(form({ mediaId: '7', progress: '3', episodes: '12' }))).toEqual({
      mediaId: 7,
      episodes: 12,
      changes: { progress: 3 },
    });
  });

  it('passes on the MyAnimeList id an AniList card sends, for a linked account', () => {
    expect(parseEntryUpdate(form({ mediaId: '7', malId: '52991', progress: '3' }))).toEqual({
      mediaId: 7,
      malId: 52991,
      changes: { progress: 3 },
    });
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
        scoreFormat: 'POINT_10',
      });
      expect(parseEntryUpdate(form({ ...fields, score: '85' }), 'myanimelist')).toEqual({
        message: "That score doesn't fit your MyAnimeList scoring system",
      });
    });
  });
});

describe('parseEntryRevert', () => {
  const json = (value: unknown) => JSON.stringify(value);

  it('reads the fields a save changed, before and after it', () => {
    expect(
      parseEntryRevert(
        form({
          before: json({ progress: 4, score: 0 }),
          after: json({ progress: 5, score: 8.5 }),
          scoreFormat: 'POINT_10_DECIMAL',
        }),
        'anilist'
      )
    ).toEqual({
      before: { progress: 4, score: 0 },
      after: { progress: 5, score: 8.5 },
      scoreFormat: 'POINT_10_DECIMAL',
    });
  });

  it('reads what a finish changed, so it can be put back', () => {
    const beforeFinish = {
      rewatched: 1,
      startedAt: '2025-01-02',
      completedAt: null,
      added: ['completedAt'],
    };

    expect(
      parseEntryRevert(
        form({
          before: json({ status: 'REPEATING', progress: 11 }),
          after: json({ status: 'COMPLETED', progress: 12 }),
          beforeFinish: json(beforeFinish),
        }),
        'myanimelist'
      )
    ).toMatchObject({ before: { status: 'REPEATING' }, beforeFinish });
  });

  it.each([
    ['nothing', {}],
    ['no fields', { before: '{}', after: '{}' }],
    ['different fields', { before: json({ progress: 4 }), after: json({ score: 8 }) }],
    ['a field it never changes', { before: json({ notes: 'a' }), after: json({ notes: 'b' }) }],
    ['an unknown list', { before: json({ status: 'GONE' }), after: json({ status: 'CURRENT' }) }],
    ['a score with no format', { before: json({ score: 0 }), after: json({ score: 8 }) }],
    [
      'a score that does not fit',
      { before: json({ score: 0 }), after: json({ score: 8.5 }), scoreFormat: 'POINT_10' },
    ],
    ['text', { before: 'four', after: json({ progress: 5 }) }],
    [
      'a broken finish',
      {
        before: json({ progress: 11 }),
        after: json({ progress: 12 }),
        beforeFinish: json({ rewatched: -1, startedAt: null, completedAt: null, added: [] }),
      },
    ],
    [
      'a finish that would clear something other than a date',
      {
        before: json({ progress: 11 }),
        after: json({ progress: 12 }),
        beforeFinish: json({ rewatched: 0, startedAt: null, completedAt: null, added: ['score'] }),
      },
    ],
  ])('turns away %s', (_, fields) => {
    expect(parseEntryRevert(form(fields), 'anilist')).toEqual({ message: 'Nothing to revert' });
  });
});
