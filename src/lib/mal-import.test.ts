import { describe, expect, it } from 'vitest';

import { malImportFile } from '#lib/mal-import.js';
import type { SyncEntry } from '#lib/sync.js';

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

describe('malImportFile', () => {
  it('writes each anime as MyAnimeList exports them, without updating ones on the list', () => {
    const file = malImportFile([{ malId: 52991, title: 'Sousou no Frieren', entry: entry() }]);

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

  it.each([
    ['PLANNING', 'Plan to Watch', 0],
    ['PAUSED', 'On-Hold', 0],
    ['DROPPED', 'Dropped', 0],
    ['COMPLETED', 'Completed', 0],
    ['REPEATING', 'Completed', 1],
  ])('writes %s as %s', (status, malStatus, rewatching) => {
    const file = malImportFile([{ malId: 1, title: 'A', entry: entry({ status }) }]);

    expect(file).toContain(`<my_status>${malStatus}</my_status>`);
    expect(file).toContain(`<my_rewatching>${rewatching}</my_rewatching>`);
  });

  it('fills the parts of a date that aren’t known with zeros', () => {
    const file = malImportFile([
      { malId: 1, title: 'A', entry: entry({ startedAt: '2026', completedAt: '2026-10' }) },
    ]);

    expect(file).toContain('<my_start_date>2026-00-00</my_start_date>');
    expect(file).toContain('<my_finish_date>2026-10-00</my_finish_date>');
  });

  it('escapes titles, so none can break the file', () => {
    const file = malImportFile([{ malId: 1, title: 'Tom & Jerry <3', entry: entry() }]);

    expect(file).toContain('<series_title>Tom &amp; Jerry &lt;3</series_title>');
  });
});
