import { redirect } from '@sveltejs/kit';

import { safeRedirectPath } from '#lib/server/redirect.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';

import type { RequestHandler } from './$types';

// POST only, so a link or image elsewhere can't sign people out. Signs out of every service.
export const POST: RequestHandler = async ({ request, cookies }) => {
  const form = await request.formData();
  clearSession(cookies);
  clearMalSession(cookies);
  redirect(303, safeRedirectPath(form.get('redirectTo')?.toString()));
};
