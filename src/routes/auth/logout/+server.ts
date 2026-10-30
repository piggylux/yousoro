import { redirect } from '@sveltejs/kit';

import { safeRedirectPath } from '#lib/server/redirect.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';

import type { RequestHandler } from './$types';

// POST only, so a link or image elsewhere can't sign people out. Signs out of the service the form
// names, as the account settings do, or else of every one, as the header's Sign out does.
export const POST: RequestHandler = async ({ request, cookies }) => {
  const form = await request.formData();
  const service = form.get('service');
  if (service !== 'myanimelist') clearSession(cookies);
  if (service !== 'anilist') clearMalSession(cookies);
  redirect(303, safeRedirectPath(form.get('redirectTo')?.toString()));
};
