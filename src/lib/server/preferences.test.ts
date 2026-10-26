import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { getPreferences, setPreferences } from '#lib/server/preferences.js';
import {
  CARD_SIZES,
  DEFAULT_PREFERENCES,
  DOWNLOAD_LANGUAGES,
  DOWNLOAD_VERSIONS,
  THEMES,
} from '#lib/types/preferences.js';

function cookiesWith(value?: string) {
  const jar = new Map<string, string>(value === undefined ? [] : [['preferences', value]]);
  return {
    get: (name: string) => jar.get(name),
    set: (name: string, newValue: string) => void jar.set(name, newValue),
  } as unknown as Cookies;
}

const cookie = (data: object) => JSON.stringify({ v: 1, data });

describe('getPreferences', () => {
  it('hides mature anime and searches every release by default', () => {
    expect(getPreferences(cookiesWith())).toEqual({
      theme: 'system',
      showMature: false,
      blurMature: true,
      cardSize: 'medium',
      downloadLanguage: 'any',
      downloadVersion: 'any',
    });
  });

  it.each([true, false])('preserves the saved show-mature choice %s', (showMature) => {
    const saved = {
      theme: 'dark',
      showMature,
      blurMature: false,
      cardSize: 'small',
      downloadLanguage: 'french',
      downloadVersion: 'dubbed',
    };
    expect(getPreferences(cookiesWith(cookie(saved)))).toEqual(saved);
  });

  it('gives settings added later their default, keeping the others', () => {
    expect(getPreferences(cookiesWith(cookie({ blurMature: false })))).toEqual({
      ...DEFAULT_PREFERENCES,
      blurMature: false,
    });
  });

  it('falls back to medium cards for an unknown card size', () => {
    expect(getPreferences(cookiesWith(cookie({ cardSize: 'huge' }))).cardSize).toBe('medium');
  });

  it('falls back to the system theme for an invalid saved theme', () => {
    expect(getPreferences(cookiesWith(cookie({ theme: 'unknown', cardSize: 'small' })))).toEqual({
      ...DEFAULT_PREFERENCES,
      cardSize: 'small',
    });
  });

  it.each([
    [
      'the wrong type',
      { blurMature: 'no', downloadLanguage: 'english', downloadVersion: 'subbed' },
      { ...DEFAULT_PREFERENCES, downloadLanguage: 'english', downloadVersion: 'subbed' },
    ],
    [
      'an unknown language',
      { blurMature: false, downloadLanguage: 'klingon', downloadVersion: 'dubbed' },
      { ...DEFAULT_PREFERENCES, blurMature: false, downloadVersion: 'dubbed' },
    ],
    [
      'an unknown version',
      { blurMature: false, downloadLanguage: 'french', downloadVersion: 'raw' },
      { ...DEFAULT_PREFERENCES, blurMature: false, downloadLanguage: 'french' },
    ],
    [
      'a show-mature setting that isn’t a yes or no',
      { showMature: 'nope', blurMature: false },
      { ...DEFAULT_PREFERENCES, blurMature: false },
    ],
  ])('falls back to the default for just the setting with %s', (_, data, expected) => {
    expect(getPreferences(cookiesWith(cookie(data)))).toEqual(expected);
  });

  it.each([
    ['a garbled cookie', 'maybe'],
    ['a newer format', '{"v":2,"data":{"blurMature":false}}'],
  ])('falls back to the defaults with %s', (_, value) => {
    expect(getPreferences(cookiesWith(value))).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('setPreferences', () => {
  it('round-trips every combination', () => {
    for (const showMature of [true, false]) {
      for (const blurMature of [true, false]) {
        for (const downloadLanguage of DOWNLOAD_LANGUAGES) {
          for (const downloadVersion of DOWNLOAD_VERSIONS) {
            for (const cardSize of CARD_SIZES) {
              for (const theme of THEMES) {
                const preferences = {
                  theme,
                  showMature,
                  blurMature,
                  cardSize,
                  downloadLanguage,
                  downloadVersion,
                };
                const cookies = cookiesWith();
                setPreferences(cookies, preferences);
                expect(getPreferences(cookies)).toEqual(preferences);
              }
            }
          }
        }
      }
    }
  });
});
