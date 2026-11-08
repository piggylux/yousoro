import { moveToListAction } from '#lib/server/move-to-list.js';

import type { Actions } from './$types';

export const actions: Actions = {
  /** Moves a planned anime to the signed-in user's "Watching" list */
  startWatching: moveToListAction('CURRENT'),
};
