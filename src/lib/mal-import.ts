import { score100ToMal } from '#lib/score.js';
import type { ImportEntry } from '#lib/sync.js';
import type { Domain } from '#lib/types/domain.js';

/** Where MyAnimeList takes a list file, to add or update many anime at once */
export const MAL_IMPORT_URL = 'https://myanimelist.net/import.php';
/** Where AniList takes a list file in MyAnimeList's format */
export const ANILIST_IMPORT_URL = 'https://anilist.co/settings/import';
/** Where MyAnimeList exports a list, worth keeping before a file updates it */
export const MAL_EXPORT_URL = 'https://myanimelist.net/panel.php?go=export';

/** Each site's import file, named so the two can't be mixed up */
export const IMPORT_FILE_NAMES: Record<Domain, string> = {
  anilist: 'yousoro-for-anilist.xml',
  myanimelist: 'yousoro-for-myanimelist.xml',
};

/** Each site's undo file, which puts back the anime its import file updates */
export const UNDO_FILE_NAMES: Record<Domain, string> = {
  anilist: 'yousoro-undo-for-anilist.xml',
  myanimelist: 'yousoro-undo-for-myanimelist.xml',
};

const STATUSES: Record<string, string> = {
  CURRENT: 'Watching',
  REPEATING: 'Completed',
  COMPLETED: 'Completed',
  PAUSED: 'On-Hold',
  DROPPED: 'Dropped',
  PLANNING: 'Plan to Watch',
};

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

// MyAnimeList writes an unknown date, or an unknown part of one, as zeros
function importDate(date: string | null): string {
  const [year = '0000', month = '00', day = '00'] = date?.split('-') ?? [];
  return `${year}-${month}-${day}`;
}

/** Whether XML 1.0 can hold a character: not most control characters, nor U+FFFE and U+FFFF */
function xmlCharacter(character: string): boolean {
  const code = character.codePointAt(0)!;
  return (code >= 0x20 || code === 0x9 || code === 0xa || code === 0xd) && code < 0xfffe;
}

// A character XML can't hold, as in a pasted comment, would make the whole file unreadable
const escape = (text: string) =>
  [...text]
    .filter(xmlCharacter)
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * The target list's own notes, tags and rewatches, so an entry the file overwrites keeps them. Only
 * what the list sent is written: a field left out stays as it is, where a guessed value would
 * overwrite it
 */
function extraFields({ entry: { extras } }: ImportEntry): string[] {
  if (!extras) return [];
  const fields: string[] = [];
  if (extras.notes !== undefined) fields.push(`<my_comments>${escape(extras.notes)}</my_comments>`);
  if (extras.rewatched !== undefined) {
    fields.push(`<my_times_watched>${extras.rewatched}</my_times_watched>`);
  }
  if (extras.tags) fields.push(`<my_tags>${escape(extras.tags.join(', '))}</my_tags>`);
  if (extras.priority !== undefined) {
    fields.push(`<my_priority>${PRIORITIES[extras.priority] ?? 'LOW'}</my_priority>`);
  }
  if (extras.rewatchValue !== undefined) {
    fields.push(`<my_rewatch_value>${extras.rewatchValue || ''}</my_rewatch_value>`);
  }
  return fields;
}

/**
 * A file in the format MyAnimeList exports lists in, which both MyAnimeList's import page and
 * AniList's read: each anime's status, episode count, score and dates. An anime already on the list
 * is marked `update_on_import`, so MyAnimeList replaces its entry; AniList replaces it when
 * "Overwrite" is ticked. Either way the entry's own notes, tags and rewatch count are written too,
 * as the list has them, so they stay. An anime not on the list yet is only added
 */
export function malImportFile(anime: ImportEntry[]) {
  const entries = anime.map((item) => {
    const { malId, title, entry, update } = item;
    return [
      '  <anime>',
      `    <series_animedb_id>${malId}</series_animedb_id>`,
      `    <series_title>${escape(title)}</series_title>`,
      `    <my_watched_episodes>${entry.progress}</my_watched_episodes>`,
      `    <my_start_date>${importDate(entry.startedAt)}</my_start_date>`,
      `    <my_finish_date>${importDate(entry.completedAt)}</my_finish_date>`,
      `    <my_score>${score100ToMal(entry.score100)}</my_score>`,
      `    <my_status>${STATUSES[entry.status] ?? 'Watching'}</my_status>`,
      `    <my_rewatching>${entry.status === 'REPEATING' ? 1 : 0}</my_rewatching>`,
      ...extraFields(item).map((field) => `    ${field}`),
      `    <update_on_import>${update ? 1 : 0}</update_on_import>`,
      '  </anime>',
    ].join('\n');
  });
  return `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_export_type>1</user_export_type>
  </myinfo>
${entries.join('\n')}
</myanimelist>
`;
}
