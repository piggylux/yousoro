import { describe, expect, it } from 'vitest';

import { malImportFile } from '#lib/mal-import.js';
import type { ImportEntry, SyncEntry } from '#lib/sync.js';

function entry(overrides: Partial<SyncEntry> = {}): SyncEntry {
  return {
    status: 'CURRENT',
    progress: 3,
    score100: 85,
    startedAt: '2026-09-01',
    completedAt: null,
    updatedAt: null,
    ...overrides,
  };
}

const anime = (overrides: Partial<ImportEntry> = {}): ImportEntry => ({
  malId: 52991,
  title: 'Sousou no Frieren',
  entry: entry(),
  update: false,
  ...overrides,
});

describe('malImportFile', () => {
  it('writes each anime as MyAnimeList exports them, adding the ones not on the list', () => {
    const file = malImportFile([anime()]);

    expect(file).toContain('<user_export_type>1</user_export_type>');
    expect(file).toContain(`  <anime>
    <series_animedb_id>52991</series_animedb_id>
    <series_title>Sousou no Frieren</series_title>
    <my_watched_episodes>3</my_watched_episodes>
    <my_start_date>2026-09-01</my_start_date>
    <my_finish_date>0000-00-00</my_finish_date>
    <my_score>9</my_score>
    <my_status>Watching</my_status>
    <my_rewatching>0</my_rewatching>
    <update_on_import>0</update_on_import>
  </anime>`);
  });

  it('updates an anime already on the list, keeping what the list has of it beyond the copy', () => {
    const file = malImportFile([
      anime({
        update: true,
        entry: entry({
          extras: {
            notes: 'Rewatch with friends',
            rewatched: 2,
            tags: ['fantasy', 'favourites'],
            priority: 2,
            rewatchValue: 5,
          },
        }),
      }),
    ]);

    expect(file).toContain(`    <my_rewatching>0</my_rewatching>
    <my_comments>Rewatch with friends</my_comments>
    <my_times_watched>2</my_times_watched>
    <my_tags>fantasy, favourites</my_tags>
    <my_priority>HIGH</my_priority>
    <my_rewatch_value>5</my_rewatch_value>
    <update_on_import>1</update_on_import>`);
  });

  it('writes only the notes and rewatches an AniList entry has', () => {
    const file = malImportFile([
      anime({ update: true, entry: entry({ extras: { notes: '', rewatched: 0 } }) }),
    ]);

    expect(file).toContain(`    <my_comments></my_comments>
    <my_times_watched>0</my_times_watched>
    <update_on_import>1</update_on_import>`);
    expect(file).not.toContain('my_tags');
    expect(file).not.toContain('my_priority');
  });

  it.each([
    ['PLANNING', 'Plan to Watch', 0],
    ['PAUSED', 'On-Hold', 0],
    ['DROPPED', 'Dropped', 0],
    ['COMPLETED', 'Completed', 0],
    ['REPEATING', 'Completed', 1],
  ])('writes %s as %s', (status, malStatus, rewatching) => {
    const file = malImportFile([anime({ entry: entry({ status }) })]);

    expect(file).toContain(`<my_status>${malStatus}</my_status>`);
    expect(file).toContain(`<my_rewatching>${rewatching}</my_rewatching>`);
  });

  it('fills the parts of a date that aren’t known with zeros', () => {
    const file = malImportFile([
      anime({ entry: entry({ startedAt: '2026', completedAt: '2026-10' }) }),
    ]);

    expect(file).toContain('<my_start_date>2026-00-00</my_start_date>');
    expect(file).toContain('<my_finish_date>2026-10-00</my_finish_date>');
  });

  it('escapes titles, notes and tags, so none can break the file', () => {
    const file = malImportFile([
      anime({
        title: 'Tom & Jerry <3',
        update: true,
        entry: entry({ extras: { notes: '</my_comments>', rewatched: 0, tags: ['a&b'] } }),
      }),
    ]);

    expect(file).toContain('<series_title>Tom &amp; Jerry &lt;3</series_title>');
    expect(file).toContain('<my_comments>&lt;/my_comments&gt;</my_comments>');
    expect(file).toContain('<my_tags>a&amp;b</my_tags>');
  });

  it('leaves out characters XML can’t hold, keeping the rest of the text', () => {
    const file = malImportFile([
      anime({ update: true, entry: entry({ extras: { notes: 'Bell\u0007 ok\ttab\nline ✨' } }) }),
    ]);

    expect(file).toContain('<my_comments>Bell ok\ttab\nline ✨</my_comments>');
  });

  it('writes only what the list sent, so a field it left out stays as it is', () => {
    const file = malImportFile([
      anime({ update: true, entry: entry({ extras: { tags: ['drama'] } }) }),
    ]);

    expect(file).toContain('<my_tags>drama</my_tags>');
    for (const field of ['my_comments', 'my_times_watched', 'my_priority', 'my_rewatch_value']) {
      expect(file).not.toContain(field);
    }
  });
});
