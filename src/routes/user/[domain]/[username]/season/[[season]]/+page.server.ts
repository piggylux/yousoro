import { addToListAction, undoAddAction } from '#lib/server/move-to-list.js';

import type { Actions } from './$types';

export const actions: Actions = {
  /**
   * Adds an anime of the season to the signed-in user's "Watching" or plan list, or moves it there
   * from another list, once the server has checked where it is
   */
  addAnime: addToListAction(),
  /** Puts an anime added from the season page back where it was */
  undoAdd: undoAddAction(),
};
