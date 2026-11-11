import {
  moveToListAction,
  removeFromPlanAction,
  undoRemoveAction,
} from '#lib/server/move-to-list.js';

import type { Actions } from './$types';

export const actions: Actions = {
  /** Moves a planned anime to the signed-in user's "Watching" list */
  startWatching: moveToListAction('CURRENT'),
  /** Takes a planned anime off the signed-in user's plan list, as Remove does */
  removeFromPlan: removeFromPlanAction(),
  /** Puts an anime taken off the plan list back on it, as Undo does */
  undoRemove: undoRemoveAction(),
};
