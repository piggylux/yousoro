import { describe, expect, it } from 'vitest';

import { formatMeanScore, formatScore, parseScore, scoreChoices } from '#lib/score.js';

describe('parseScore', () => {
  it.each([
    ['POINT_100', '85', 85],
    ['POINT_100', '0', 0],
    ['POINT_10_DECIMAL', '8.5', 8.5],
    ['POINT_10_DECIMAL', '8.3', 8.3],
    ['POINT_10_DECIMAL', ' 6.0 ', 6],
    ['POINT_10', '7', 7],
    ['POINT_5', '4', 4],
    ['POINT_3', '3', 3],
  ] as const)('reads a %s score of "%s" as %s', (format, value, expected) => {
    expect(parseScore(value, format)).toBe(expected);
  });

  it.each([
    ['POINT_100', '101'],
    ['POINT_100', '85.5'],
    ['POINT_10_DECIMAL', '8.25'],
    ['POINT_10_DECIMAL', '10.5'],
    ['POINT_10', '7.5'],
    ['POINT_5', '6'],
    ['POINT_3', '4'],
    ['POINT_10', '-1'],
    ['POINT_10', 'abc'],
    ['POINT_10', ''],
  ] as const)('refuses a %s score of "%s"', (format, value) => {
    expect(parseScore(value, format)).toBeNull();
  });

  it('refuses anything but text', () => {
    expect(parseScore(7, 'POINT_10')).toBeNull();
    expect(parseScore(null, 'POINT_10')).toBeNull();
  });
});

describe('formatScore', () => {
  it.each([
    ['POINT_100', 85, '85 / 100'],
    ['POINT_10_DECIMAL', 8.5, '8.5 / 10'],
    ['POINT_10', 8, '8 / 10'],
    ['POINT_5', 4, '★★★★☆'],
    ['POINT_3', 3, '🙂'],
    ['POINT_3', 1, '🙁'],
  ] as const)('shows a %s score of %s as "%s"', (format, score, expected) => {
    expect(formatScore(score, format)).toBe(expected);
  });
});

describe('formatScore with an unexpected star score', () => {
  it.each([
    [7, '★★★★★'],
    [-1, '☆☆☆☆☆'],
    [3.6, '★★★★☆'],
  ])('shows %s stars as "%s" rather than failing', (score, expected) => {
    expect(formatScore(score, 'POINT_5')).toBe(expected);
  });
});

describe('scoreChoices', () => {
  it('offers every star, after "No score"', () => {
    expect(scoreChoices('POINT_5')?.map((choice) => choice.value)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(scoreChoices('POINT_5')?.[4].label).toBe('★★★★☆ 4/5');
  });

  it('names the smileys', () => {
    expect(scoreChoices('POINT_3')?.map((choice) => choice.label)).toEqual([
      'No score',
      '🙁 Disliked',
      '😐 Neutral',
      '🙂 Liked',
    ]);
  });

  it('leaves number formats to a number field', () => {
    expect(scoreChoices('POINT_100')).toBeNull();
    expect(scoreChoices('POINT_10_DECIMAL')).toBeNull();
  });
});

describe('formatMeanScore', () => {
  it('shows a percentage, as AniList does', () => {
    expect(formatMeanScore(78)).toBe('78%');
  });
});
