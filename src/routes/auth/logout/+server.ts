import { redirect } from '@sveltejs/kit';

import { safeRedirectPath } from '#lib/server/redirect.js';
import { clearSession } from '#lib/server/session.js';

import type { RequestHandler } from './$types';

// POST only, so a link or image elsewhere can't sign people out
export const POST: RequestHandler = async ({ request, cookies }) => {
  const form = await request.formData();
  clearSession(cookies);
  redirect(303, safeRedirectPath(form.get('redirectTo')?.toString()));
};
