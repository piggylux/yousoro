import { isScoreFormat, parseScore, type ScoreFormat } from '#lib/score.js';
import type { BeforeFinish, EntryDate, ListMove } from '#lib/types/api.js';
import { DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

export type EntryChanges = {
  progress?: number;
  score?: number;
  /**
   * Moved to "Watching", as from the plan list, or to "Planning", as an announced sequel, and
   * nothing else. A copy to a linked account then sets the status alone: that list may be further
   * along, and its episode count and dates stay
   */
  move?: ListMove;
};

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

/** An entry's fields a save changed, in AniList's terms and the owner's score format */
export type EntryFields = { status?: string; progress?: number; score?: number };

export type EntryRevert = {
  /** What the fields the save changed held before it, which reverting puts back */
  before: EntryFields;
  /** What the save left in them, which they must still hold, or the entry changed since */
  after: EntryFields;
  /** The score format both scores are in, when the save changed the score */
  scoreFormat?: ScoreFormat;
  /** What the entry held before the save finished the anime, when it did */
  beforeFinish?: BeforeFinish;
};

const STATUSES = new Set(['CURRENT', 'REPEATING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNING']);
// As fromFuzzyDate writes them, and MyAnimeList too: YYYY-MM-DD, or YYYY-MM or YYYY
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

function readJson(value: FormDataEntryValue | null): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readFields(value: FormDataEntryValue | null, format?: ScoreFormat): EntryFields | null {
  const raw = readJson(value);
  if (!raw) return null;
  const fields: EntryFields = {};
  for (const [name, field] of Object.entries(raw)) {
    if (name === 'status' && typeof field === 'string' && STATUSES.has(field)) {
      fields.status = field;
    } else if (name === 'progress' && Number.isInteger(field) && (field as number) >= 0) {
      fields.progress = field as number;
    } else if (name === 'score' && format && typeof field === 'number') {
      const score = parseScore(String(field), format);
      if (score === null) return null;
      fields.score = score;
    } else return null;
  }
  return fields;
}

const ENTRY_DATES: readonly unknown[] = ['startedAt', 'completedAt'] satisfies EntryDate[];

function readBeforeFinish(value: FormDataEntryValue | null): BeforeFinish | null {
  const raw = readJson(value);
  const date = (field: unknown) =>
    field === null || (typeof field === 'string' && DATE.test(field));
  if (!raw || !Number.isInteger(raw.rewatched) || (raw.rewatched as number) < 0) return null;
  if (!date(raw.startedAt) || !date(raw.completedAt)) return null;
  const { added } = raw;
  if (!Array.isArray(added) || !added.every((name) => ENTRY_DATES.includes(name))) return null;
  return {
    rewatched: raw.rewatched as number,
    startedAt: raw.startedAt as string | null,
    completedAt: raw.completedAt as string | null,
    added: added as EntryDate[],
  };
}

/**
 * What a form reverting a save asks: the fields the save changed, as they were `before` it and as it
 * left them (`after`), sent as JSON, with the score format the scores are in, and what the entry held
 * before the save finished the anime, when it did. Both name the same fields, at least one. Returns a
 * message for the user when something doesn't fit
 */
export function parseEntryRevert(
  form: FormData,
  domain: Domain
): EntryRevert | { message: string } {
  const format = FIXED_SCORE_FORMATS[domain] ?? form.get('scoreFormat');
  const scoreFormat = isScoreFormat(format) ? format : undefined;
  const before = readFields(form.get('before'), scoreFormat);
  const after = readFields(form.get('after'), scoreFormat);
  const names = (fields: EntryFields) => Object.keys(fields).sort().join();
  if (!before || !after || !names(before) || names(before) !== names(after)) {
    return { message: 'Nothing to revert' };
  }
  const revert: EntryRevert = { before, after, ...(scoreFormat && { scoreFormat }) };
  if (form.has('beforeFinish')) {
    const beforeFinish = readBeforeFinish(form.get('beforeFinish'));
    if (!beforeFinish) return { message: 'Nothing to revert' };
    revert.beforeFinish = beforeFinish;
  }
  return revert;
}

/**
 * Which anime a "Start watching" or "Add to Planning" form asks to move on the list owner's list:
 * by its AniList id on an AniList list, and by its MyAnimeList id on a MyAnimeList list, whose
 * planned anime aren't looked up on AniList. The other id comes too when the page knows it, to copy
 * the change to a linked account. Returns a message for the user when an id is missing
 */
export function parseListMove(
  form: FormData,
  domain: Domain
): { mediaId?: number; malId?: number } | { message: string } {
  const mediaId = positiveInteger(form.get('mediaId'));
  const malId = positiveInteger(form.get('malId'));
  if ((domain === 'anilist' ? mediaId : malId) === null) return { message: 'Unknown anime' };
  return { ...(mediaId === null ? {} : { mediaId }), ...(malId === null ? {} : { malId }) };
}
