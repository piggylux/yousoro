import { setPreferences, toPreferences } from '#lib/server/preferences.js';

import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const preferences = toPreferences({
      // An unticked checkbox sends nothing, so its absence means "off"
      showMature: form.get('showMature') === 'on',
      blurMature: form.get('blurMature') === 'on',
      cardSize: form.get('cardSize'),
      downloadLanguage: form.get('downloadLanguage'),
      downloadVersion: form.get('downloadVersion'),
    });
    setPreferences(cookies, preferences);
    return { saved: true, preferences };
  },
};
