import { score100ToMal } from '#lib/score.js';
import type { SyncEntry } from '#lib/sync.js';

/** Where MyAnimeList takes a list file, to add many anime at once */
export const MAL_IMPORT_URL = 'https://myanimelist.net/import.php';

const STATUSES: Record<string, string> = {
  CURRENT: 'Watching',
  REPEATING: 'Completed',
  COMPLETED: 'Completed',
  PAUSED: 'On-Hold',
  DROPPED: 'Dropped',
  PLANNING: 'Plan to Watch',
};

// MyAnimeList writes an unknown date, or an unknown part of one, as zeros
function importDate(date: string | null): string {
  const [year = '0000', month = '00', day = '00'] = date?.split('-') ?? [];
  return `${year}-${month}-${day}`;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A file in the format MyAnimeList exports lists in, which its import page reads, adding anime that
 * aren't on the list yet: their status, episode count, score and dates. `update_on_import` is off,
 * so MyAnimeList leaves an anime already on the list as it is, including what the file doesn't
 * hold, like its tags, comments and rewatch count
 */
export function malImportFile(anime: { malId: number; title: string; entry: SyncEntry }[]) {
  const entries = anime.map(
    ({ malId, title, entry }) => `  <anime>
    <series_animedb_id>${malId}</series_animedb_id>
    <series_title>${escape(title)}</series_title>
    <my_watched_episodes>${entry.progress}</my_watched_episodes>
    <my_start_date>${importDate(entry.startedAt)}</my_start_date>
    <my_finish_date>${importDate(entry.completedAt)}</my_finish_date>
    <my_score>${score100ToMal(entry.score100)}</my_score>
    <my_status>${STATUSES[entry.status] ?? 'Watching'}</my_status>
    <my_rewatching>${entry.status === 'REPEATING' ? 1 : 0}</my_rewatching>
    <update_on_import>0</update_on_import>
  </anime>`
  );
  return `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_export_type>1</user_export_type>
  </myinfo>
${entries.join('\n')}
</myanimelist>
`;
}
