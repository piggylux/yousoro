import { setPreferences, toPreferences } from '#lib/server/preferences.js';

import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies, locals }) => {
    const form = await request.formData();
    const preferences = toPreferences({
      theme: form.get('theme'),
      // An unticked checkbox sends nothing, so its absence means "off"
      showMature: form.get('showMature') === 'on',
      blurMature: form.get('blurMature') === 'on',
      cardSize: form.get('cardSize'),
      downloadLanguage: form.get('downloadLanguage'),
      downloadVersion: form.get('downloadVersion'),
    });
    setPreferences(cookies, preferences);
    locals.preferences = preferences;
    return { saved: true, preferences };
  },
};
