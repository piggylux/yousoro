import { redirect } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  // Signed-in visitors go straight to their own list
  if (locals.session) {
    redirect(303, `/user/anilist/${encodeURIComponent(locals.session.user.name)}`);
  }
};
