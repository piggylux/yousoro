import { isScoreFormat, parseScore, type ScoreFormat } from '#lib/score.js';
import { DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

export type EntryChanges = { progress?: number; score?: number };

/** MyAnimeList scores are always whole numbers out of 10, whatever a form says */
const FIXED_SCORE_FORMATS: Partial<Record<Domain, ScoreFormat>> = { myanimelist: 'POINT_10' };

function positiveInteger(value: FormDataEntryValue | null): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export type EntryUpdate = {
  mediaId: number;
  /** The anime's MyAnimeList id, when known: needed to save to MyAnimeList */
  malId?: number;
  changes: EntryChanges;
  /** The score format `changes.score` is in, when a score is saved */
  scoreFormat?: ScoreFormat;
  /** How many episodes the page says the anime has, when it knows */
  episodes?: number;
};

/**
 * What a submitted form asks to change on a list entry: the watched episode count, the score, or
 * both. A field that isn't sent stays as it is; an empty score field means no score. The score is
 * read in the score format the page sends, which is the list owner's, and the owner is the only one
 * who can update the list. A MyAnimeList list also needs the anime's MyAnimeList id, which an
 * AniList list sends too when known, to copy the save to a linked MyAnimeList account. Returns a
 * message for the user when something doesn't fit
 */
export function parseEntryUpdate(
  form: FormData,
  domain: Domain = 'anilist'
): EntryUpdate | { message: string } {
  const mediaId = positiveInteger(form.get('mediaId'));
  if (mediaId === null) return { message: 'Unknown anime' };
  const malId = positiveInteger(form.get('malId'));
  if (domain === 'myanimelist' && malId === null) return { message: 'Unknown anime' };

  const update: EntryUpdate = { mediaId, ...(malId === null ? {} : { malId }), changes: {} };
  const episodes = positiveInteger(form.get('episodes'));
  if (episodes !== null) update.episodes = episodes;
  const { changes } = update;
  if (form.has('progress')) {
    const progress = Number(form.get('progress'));
    if (!Number.isInteger(progress) || progress < 0) return { message: 'Invalid episode count' };
    changes.progress = progress;
  }
  if (form.has('score')) {
    const format = FIXED_SCORE_FORMATS[domain] ?? form.get('scoreFormat');
    const raw = form.get('score');
    const score = isScoreFormat(format) ? parseScore(raw === '' ? '0' : raw, format) : null;
    if (score === null || !isScoreFormat(format)) {
      return { message: `That score doesn't fit your ${DOMAIN_NAMES[domain]} scoring system` };
    }
    changes.score = score;
    update.scoreFormat = format;
  }
  if (changes.progress === undefined && changes.score === undefined) {
    return { message: 'Nothing to update' };
  }
  return update;
}
