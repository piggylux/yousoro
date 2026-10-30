/** AniList's scoring systems; each user picks one, and their scores are shown and edited in it */
export const SCORE_FORMATS = [
  'POINT_100',
  'POINT_10_DECIMAL',
  'POINT_10',
  'POINT_5',
  'POINT_3',
] as const;
export type ScoreFormat = (typeof SCORE_FORMATS)[number];

/** AniList's own default, for when a user's format can't be read */
export const DEFAULT_SCORE_FORMAT: ScoreFormat = 'POINT_10';

export function isScoreFormat(value: unknown): value is ScoreFormat {
  return SCORE_FORMATS.includes(value as ScoreFormat);
}

/** The highest score of each format, and the smallest step between two scores */
export const SCORE_SCALES: Record<ScoreFormat, { max: number; step: number }> = {
  POINT_100: { max: 100, step: 1 },
  POINT_10_DECIMAL: { max: 10, step: 0.1 },
  POINT_10: { max: 10, step: 1 },
  POINT_5: { max: 5, step: 1 },
  POINT_3: { max: 3, step: 1 },
};

const SMILEYS = ['🙁', '😐', '🙂'];
const SMILEY_NAMES = ['Disliked', 'Neutral', 'Liked'];

/**
 * A submitted score, or null when it doesn't fit the format: from 0 (no score) to the format's
 * highest, in its steps
 */
export function parseScore(value: unknown, format: ScoreFormat): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const score = Number(value);
  const { max, step } = SCORE_SCALES[format];
  if (!Number.isFinite(score) || score < 0 || score > max) return null;
  // Counted in steps, so floating point can't make 8.3 look like it has more decimals
  const steps = Math.round(score / step);
  return Math.abs(steps - score / step) < 1e-9 ? Number((steps * step).toFixed(1)) : null;
}

/** A score as AniList shows it in the format: "85 / 100", "8.5 / 10", "★★★★☆" or "🙂" */
export function formatScore(score: number, format: ScoreFormat): string {
  switch (format) {
    case 'POINT_5': {
      // Kept within 0 to 5 whole stars, so an unexpected score can't break the page
      const stars = Math.min(5, Math.max(0, Math.round(score)));
      return '★'.repeat(stars) + '☆'.repeat(5 - stars);
    }
    case 'POINT_3':
      return SMILEYS[score - 1] ?? '';
    default:
      return `${score} / ${SCORE_SCALES[format].max}`;
  }
}

/** The same in words, for screen readers: "4 out of 5", "Liked" */
export function describeScore(score: number, format: ScoreFormat): string {
  if (format === 'POINT_3') return SMILEY_NAMES[score - 1] ?? '';
  return `${score} out of ${SCORE_SCALES[format].max}`;
}

/**
 * The scores to pick from, for the formats with only a few (stars and smileys), "No score" first;
 * null for the formats typed as a number
 */
export function scoreChoices(format: ScoreFormat): { value: number; label: string }[] | null {
  if (format !== 'POINT_5' && format !== 'POINT_3') return null;
  const { max } = SCORE_SCALES[format];
  return [
    { value: 0, label: 'No score' },
    ...Array.from({ length: max }, (_, i) => ({
      value: i + 1,
      // Short, so the dropdown fits small cards: "★★★★☆ 4/5", "🙂 Liked"
      label:
        format === 'POINT_5'
          ? `${formatScore(i + 1, format)} ${i + 1}/${max}`
          : `${formatScore(i + 1, format)} ${describeScore(i + 1, format)}`,
    })),
  ];
}

/**
 * A score out of 100, to compare it with a score in another format. Smileys count as 35, 60 and
 * 85, as AniList counts them
 */
export function toScore100(score: number, format: ScoreFormat): number {
  if (format === 'POINT_3') return [0, 35, 60, 85][score] ?? 0;
  return Math.round((score * 100) / SCORE_SCALES[format].max);
}

/**
 * A score in MyAnimeList's whole numbers out of 10, 0 meaning no score. A low score still counts as
 * 1, as rounding it to 0 would clear it
 */
export function toMalScore(score: number, format: ScoreFormat): number {
  return score100ToMal(toScore100(score, format));
}

/** A score out of 100 in MyAnimeList's whole numbers out of 10, as toMalScore gives it */
export function score100ToMal(score100: number): number {
  return score100 > 0 ? Math.max(1, Math.round(score100 / 10)) : 0;
}

/** AniList's mean score, out of 100, as AniList shows it */
export function formatMeanScore(meanScore: number) {
  return `${meanScore}%`;
}
