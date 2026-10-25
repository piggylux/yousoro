import type { Cookies } from '@sveltejs/kit';

import { type CookieFormat, readVersioned, writeVersioned } from '#lib/server/versioned-cookie.js';
import {
  DEFAULT_PREFERENCES,
  isCardSize,
  isDownloadLanguage,
  isDownloadVersion,
  type Preferences,
} from '#lib/types/preferences.js';

const PREFERENCES_COOKIE = 'preferences';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Settings from saved or submitted values. Each setting falls back to its default on its own when
 * it's missing or invalid, so adding a setting needs no new cookie format version: cookies saved
 * before it simply don't have it yet
 */
export function toPreferences(values: Partial<Record<keyof Preferences, unknown>>): Preferences {
  return {
    blurMature:
      typeof values.blurMature === 'boolean' ? values.blurMature : DEFAULT_PREFERENCES.blurMature,
    cardSize: isCardSize(values.cardSize) ? values.cardSize : DEFAULT_PREFERENCES.cardSize,
    downloadLanguage: isDownloadLanguage(values.downloadLanguage)
      ? values.downloadLanguage
      : DEFAULT_PREFERENCES.downloadLanguage,
    downloadVersion: isDownloadVersion(values.downloadVersion)
      ? values.downloadVersion
      : DEFAULT_PREFERENCES.downloadVersion,
  };
}

const PREFERENCES_FORMAT: CookieFormat<Preferences> = {
  version: 1,
  parse: (data) => (typeof data === 'object' && data !== null ? toPreferences(data) : null),
};

// A cookie rather than localStorage, so the server renders mature covers already blurred instead
// of showing them for a moment until the page's script runs. A missing or unreadable cookie means
// the defaults, which stay on the safe side.
export function getPreferences(cookies: Cookies): Preferences {
  return readVersioned(cookies.get(PREFERENCES_COOKIE), PREFERENCES_FORMAT) ?? DEFAULT_PREFERENCES;
}

export function setPreferences(cookies: Cookies, preferences: Preferences) {
  cookies.set(PREFERENCES_COOKIE, writeVersioned(preferences, PREFERENCES_FORMAT), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ONE_YEAR_SECONDS,
  });
}
