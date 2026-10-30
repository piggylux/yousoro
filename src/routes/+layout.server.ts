import { MAL_ENABLED } from '#lib/server/myanimelist-auth.js';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  return {
    /** The AniList account, which the friends and taste features belong to */
    user: locals.session?.user ?? null,
    /** The MyAnimeList account, signed in alongside AniList's or on its own */
    malUser: locals.malSession?.user ?? null,
    malEnabled: MAL_ENABLED,
    preferences: locals.preferences,
  };
};
