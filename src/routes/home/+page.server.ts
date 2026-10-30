import { redirect } from '@sveltejs/kit';

import { listPath } from '#lib/types/domain.js';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  // Signed-in visitors go straight to their own list: their main one, when signed in to both
  const { session, malSession } = locals;
  if (malSession && (!session || locals.preferences.mainList === 'myanimelist')) {
    redirect(303, listPath('myanimelist', malSession.user.name));
  }
  if (session) redirect(303, listPath('anilist', session.user.name));
};
