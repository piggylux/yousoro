import { redirect } from '@sveltejs/kit';

import { safeRedirectPath } from '#lib/server/redirect.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import { isDomain, type Domain } from '#lib/types/domain.js';

import type { RequestHandler } from './$types';

/**
 * Whether a path is one of an account's own pages: its list, or a page under it. Names match
 * whatever their case, as the services' do
 */
function isAccountPage(path: string, account: { domain: Domain; name: string }) {
  const [, user, domain, name] = new URL(path, 'http://localhost').pathname.split('/');
  if (user !== 'user' || !domain || !isDomain(domain) || !name) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return false;
  }
  return domain === account.domain && decoded.toLowerCase() === account.name.toLowerCase();
}

// POST only, so a link or image elsewhere can't sign people out. Signs out of the service the form
// names, as the account settings do, or else of every one, as the header's Sign out does. It comes
// back to the page it was sent from, except one of an account it signed out of: that would show
// the account's public pages as if it were still the viewer's, and a sign-in to the other service
// from there would come back to them too. Home then leads to the list still signed in, if any
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const form = await request.formData();
  const service = form.get('service');
  const signedOut: { domain: Domain; name: string }[] = [];
  if (service !== 'myanimelist') {
    if (locals.session) signedOut.push({ domain: 'anilist', name: locals.session.user.name });
    clearSession(cookies);
  }
  if (service !== 'anilist') {
    if (locals.malSession) {
      signedOut.push({ domain: 'myanimelist', name: locals.malSession.user.name });
    }
    clearMalSession(cookies);
  }
  const to = safeRedirectPath(form.get('redirectTo')?.toString());
  redirect(303, signedOut.some((account) => isAccountPage(to, account)) ? '/home' : to);
};
