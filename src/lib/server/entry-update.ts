import { isScoreFormat, parseScore, type ScoreFormat } from '#lib/score.js';
import { DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

export type EntryChanges = { progress?: number; score?: number };

/** MyAnimeList scores are always whole numbers out of 10, whatever a form says */
const FIXED_SCORE_FORMATS: Partial<Record<Domain, ScoreFormat>> = { myanimelist: 'POINT_10' };

function positiveInteger(value: FormDataEntryValue | null): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * What a submitted form asks to change on a list entry: the watched episode count, the score, or
 * both. A field that isn't sent stays as it is; an empty score field means no score. The score is
 * read in the score format the page sends, which is the list owner's, and the owner is the only one
 * who can update the list. A MyAnimeList list also needs the anime's MyAnimeList id. Returns a
 * message for the user when something doesn't fit
 */
export function parseEntryUpdate(
  form: FormData,
  domain: Domain = 'anilist'
): { mediaId: number; malId?: number; changes: EntryChanges } | { message: string } {
  const mediaId = positiveInteger(form.get('mediaId'));
  if (mediaId === null) return { message: 'Unknown anime' };
  const malId = domain === 'myanimelist' ? positiveInteger(form.get('malId')) : null;
  if (domain === 'myanimelist' && malId === null) return { message: 'Unknown anime' };

  const changes: EntryChanges = {};
  if (form.has('progress')) {
    const progress = Number(form.get('progress'));
    if (!Number.isInteger(progress) || progress < 0) return { message: 'Invalid episode count' };
    changes.progress = progress;
  }
  if (form.has('score')) {
    const format = FIXED_SCORE_FORMATS[domain] ?? form.get('scoreFormat');
    const raw = form.get('score');
    const score = isScoreFormat(format) ? parseScore(raw === '' ? '0' : raw, format) : null;
    if (score === null) {
      return { message: `That score doesn't fit your ${DOMAIN_NAMES[domain]} scoring system` };
    }
    changes.score = score;
  }
  if (changes.progress === undefined && changes.score === undefined) {
    return { message: 'Nothing to update' };
  }
  return malId === null ? { mediaId, changes } : { mediaId, malId, changes };
}
