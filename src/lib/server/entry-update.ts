import { isScoreFormat, parseScore } from '#lib/score.js';

export type EntryChanges = { progress?: number; score?: number };

/**
 * What a submitted form asks to change on a list entry: the watched episode count, the score, or
 * both. A field that isn't sent stays as it is; an empty score field means no score. The score is
 * read in the score format the page sends, which is the list owner's, and the owner is the only one
 * who can update the list. Returns a message for the user when something doesn't fit
 */
export function parseEntryUpdate(
  form: FormData
): { mediaId: number; changes: EntryChanges } | { message: string } {
  const mediaId = Number(form.get('mediaId'));
  if (!Number.isInteger(mediaId) || mediaId <= 0) return { message: 'Unknown anime' };

  const changes: EntryChanges = {};
  if (form.has('progress')) {
    const progress = Number(form.get('progress'));
    if (!Number.isInteger(progress) || progress < 0) return { message: 'Invalid episode count' };
    changes.progress = progress;
  }
  if (form.has('score')) {
    const format = form.get('scoreFormat');
    const raw = form.get('score');
    const score = isScoreFormat(format) ? parseScore(raw === '' ? '0' : raw, format) : null;
    if (score === null) return { message: "That score doesn't fit your AniList scoring system" };
    changes.score = score;
  }
  if (changes.progress === undefined && changes.score === undefined) {
    return { message: 'Nothing to update' };
  }
  return { mediaId, changes };
}
