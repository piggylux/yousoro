import { defineEnvVars } from '@sveltejs/kit/env';

function required(name: string) {
  return (value: string | undefined) => {
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
}

export const variables = defineEnvVars({
  ANILIST_TOKEN: { schema: required('ANILIST_TOKEN') },
  MAL_CLIENT_ID: { schema: required('MAL_CLIENT_ID') },
});
