import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  // Client IDs aren't secret: AniList's implicit grant sends it from the browser
  ANILIST_CLIENT_ID: {
    public: true,
    schema: (value) => {
      if (!value) {
        throw new Error(
          'ANILIST_CLIENT_ID is required: create a client at https://anilist.co/settings/developer'
        );
      }
      return value;
    },
    description:
      'ID of the AniList API client used for signing in. Its redirect URL must be <origin>/auth/anilist/callback',
  },
  // MyAnimeList is optional: without its client, its sign-in and lists are switched off
  MAL_CLIENT_ID: {
    schema: (value) => value || undefined,
    description:
      'ID of the MyAnimeList API client, of the "web" type. Its redirect URL must be <origin>/auth/myanimelist/callback',
  },
  MAL_CLIENT_SECRET: {
    schema: (value) => value || undefined,
    description: 'Secret of the MyAnimeList API client, which exchanges sign-in codes for tokens',
  },
});
