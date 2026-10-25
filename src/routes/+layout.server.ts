import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  return { user: locals.session?.user ?? null, preferences: locals.preferences };
};
