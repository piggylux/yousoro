import { building } from '$app/env';
import type { Handle } from '@sveltejs/kit/hooks';

import { getPageSeo } from '#lib/seo.js';
import { getPreferences } from '#lib/server/preferences.js';
import { getSession } from '#lib/server/session.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

export const handle: Handle = async ({ event, resolve }) => {
  const url = new URL(event.request.url);
  const path = url.pathname;
  // Prerendered pages are shared, so they never see personal cookies.
  event.locals.session = building ? null : getSession(event.cookies);
  event.locals.preferences = building ? DEFAULT_PREFERENCES : getPreferences(event.cookies);
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => {
      const theme = event.locals.preferences.theme;
      return html.replace('%yousoro.theme%', theme === 'system' ? '' : `data-theme="${theme}"`);
    },
  });

  if (event.locals.retryAfter !== undefined) {
    response.headers.set('Retry-After', String(event.locals.retryAfter));
  }
  if (getPageSeo(url, response.status).noindex || event.locals.session) {
    response.headers.set('X-Robots-Tag', 'noindex, follow');
  }
  return secureResponse(response, path);
};

function secureResponse(response: Response, path: string) {
  // No other site may frame these pages, so the progress buttons can't be clickjacked. The
  // Content-Security-Policy, set in vite.config.ts, also forbids framing, for newer browsers.
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set(
    'Referrer-Policy',
    path.startsWith('/auth/') ? 'no-referrer' : 'strict-origin-when-cross-origin'
  );
  // Layouts and data responses vary with cookies, and may contain private AniList entries.
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Pragma', 'no-cache');

  return response;
}
