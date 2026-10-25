import { building } from '$app/env';
import type { Handle } from '@sveltejs/kit/hooks';

import { getSession } from '#lib/server/session.js';

export const handle: Handle = async ({ event, resolve }) => {
  // Prerendered pages are shared by everyone, so they never see a session
  event.locals.session = building ? null : getSession(event.cookies);

  const response = await resolve(event);

  // No other site may frame these pages, so the progress buttons can't be clickjacked. The
  // Content-Security-Policy, set in vite.config.ts, also forbids framing, for newer browsers.
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
};
