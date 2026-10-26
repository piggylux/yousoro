import { building } from '$app/env';
import type { Handle } from '@sveltejs/kit/hooks';

import { getPreferences } from '#lib/server/preferences.js';
import { getSession } from '#lib/server/session.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

export const handle: Handle = async ({ event, resolve }) => {
  // Prerendered pages are shared by everyone, so they never see a session or personal settings
  event.locals.session = building ? null : getSession(event.cookies);
  event.locals.preferences = building ? DEFAULT_PREFERENCES : getPreferences(event.cookies);

  const response = await resolve(event, {
    transformPageChunk: ({ html }) => {
      const theme = event.locals.preferences.theme;
      return html.replace('%yousoro.theme%', theme === 'system' ? '' : `data-theme="${theme}"`);
    },
  });

  // No other site may frame these pages, so the progress buttons can't be clickjacked. The
  // Content-Security-Policy, set in vite.config.ts, also forbids framing, for newer browsers.
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
};
