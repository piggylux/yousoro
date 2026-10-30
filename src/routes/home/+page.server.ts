import { redirect } from '@sveltejs/kit';

import { listPath } from '#lib/types/domain.js';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  // Signed-in visitors go straight to their own list
  if (locals.session) redirect(303, listPath('anilist', locals.session.user.name));
  if (locals.malSession) redirect(303, listPath('myanimelist', locals.malSession.user.name));
};
