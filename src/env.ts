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
});
