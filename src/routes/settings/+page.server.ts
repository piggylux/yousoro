import { setPreferences } from '#lib/server/preferences.js';

import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    // An unticked checkbox sends nothing, so its absence means "off"
    const preferences = { blurMature: form.get('blurMature') === 'on' };
    setPreferences(cookies, preferences);
    return { saved: true, preferences };
  },
};
