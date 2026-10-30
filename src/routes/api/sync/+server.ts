import { error, json } from '@sveltejs/kit';

import { takeClientLimit } from '#lib/server/rate-limit.js';
import { applySyncChanges, parseSyncChanges } from '#lib/server/sync.js';
import { SYNC_ENABLED } from '#lib/sync.js';

import type { RequestHandler } from './$types';

/**
 * Applies a few of the changes the sync page lists. Changes a busy service couldn't take come back
 * untried, with how long it asks to wait, and the page sends them again later. When a sign-in can't
 * be renewed, syncing stops and that service is signed out
 */
export const POST: RequestHandler = async (event) => {
  const { request, locals, getClientAddress } = event;
  if (!SYNC_ENABLED) error(404, 'Syncing lists is not available on this site');
  const limit = await takeClientLimit(getClientAddress(), 'write');
  if (!limit.allowed) {
    locals.retryAfter = limit.retryAfter;
    error(429, 'Too many updates, please try again shortly');
  }
  // JSON only, which another site can't send here without the browser asking first
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    error(415, 'Expected JSON');
  }
  if (!locals.session || !locals.malSession) error(401, 'Sign in to both services to sync them');
  const changes = parseSyncChanges((await request.json().catch(() => null))?.changes);
  if (!changes) error(400, 'Invalid changes');

  return json(await applySyncChanges(event, changes));
};
