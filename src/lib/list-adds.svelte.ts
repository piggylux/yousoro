import type { SubmitFunction } from '$app/forms';

import {
  describeListed,
  describeWatching,
  type FoundAnime,
  type FoundState,
} from '#lib/anime-search.js';
import { forgetChange, recordListChange, updateChange } from '#lib/change-history.js';
import { isBefore, type Before, type LinkedFailure, type ListMove } from '#lib/types/api.js';
import { DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';
import type { SessionUser } from '#lib/types/session-user.js';

/**
 * Adding anime to the viewer's own list from a page that found them, as the anime search and the
 * season page do, and undoing that: what each anime's buttons have done, and the saves behind
 * them. The buttons themselves are `AddToListActions.svelte`, which posts to the page's `addAnime`
 * and `undoAdd` actions
 */

/** What was done to one anime, as its buttons and status show it */
export type Add = {
  saving: boolean;
  /** The list it went to, or already was on */
  added?: ListMove;
  already?: boolean;
  /** Moved from another of the lists, rather than added */
  moved?: boolean;
  /** Where it was before, which undoing puts it back to; unknown when it was there already */
  before?: Before;
  /** Where it was on the linked account, when the add changed it there too */
  linkedBefore?: Before;
  /** Being undone, which its Undo button shows */
  undoing?: boolean;
  /** The add in the history of recent changes, which undoing it here takes off there */
  changeId?: string;
  linked?: LinkedFailure;
  message?: string;
};

/**
 * The one thing to do with an anime: start a planned one, resume a paused or dropped one, go to
 * the card of one being watched, plan one not out yet, or start or plan a new one
 */
export type AddAction = 'start' | 'resume' | 'show' | 'plan' | 'add';

/** Called once a save or an undo finished, `ok` or not, to put focus back where it helps */
export type Settled = (ok: boolean, form: HTMLFormElement) => void | Promise<void>;

type Options = {
  /** The service the list is on, which anime are added to */
  domain: () => Domain;
  /** Who is signed in, whose history of recent changes an add goes to */
  signedIn: () => { user?: SessionUser | null; malUser?: SessionUser | null };
  /** Says something to screen readers, in the page's own live region */
  announce: (text: string) => void;
  /** Called when an anime was added or started, with the episode count it's at there */
  onAdded?: (anime: FoundAnime, list: ListMove, progress: number) => void;
  /** Called when an add was undone, with the list the anime had gone to */
  onUndone?: (anime: FoundAnime, list: ListMove) => void;
};

const listName = (list: ListMove) => (list === 'CURRENT' ? 'Watching list' : 'plan list');
const addedText = ({ added, already, moved }: Add) =>
  `${already ? 'Already on' : moved ? 'Moved to' : 'Added to'} your ${listName(added!)}`;

export class ListAdds {
  /** What was done to each anime, by AniList id */
  entries = $state<Record<number, Add>>({});
  #options: Options;

  constructor(options: Options) {
    this.#options = options;
  }

  get(id: number): Add | undefined {
    return this.entries[id];
  }

  /** Whether an anime was added or moved from here, so it stays in sight */
  isAdded(id: number): boolean {
    return !!this.entries[id]?.added;
  }

  /** Whether an add can be undone: it went somewhere, from where it was known to be */
  undoable(id: number): boolean {
    const entry = this.entries[id];
    return !!entry?.added && entry.before !== undefined;
  }

  /**
   * The one thing to do with an anime, if any. A completed one, or one just started, has nothing
   * left to do here; one being watched is only shown when the page can show its card
   */
  actionFor(anime: FoundAnime, where: FoundState, canShow: boolean): AddAction | null {
    const entry = this.entries[anime.id];
    const out = anime.status !== 'NOT_YET_RELEASED';
    if (entry?.added === 'CURRENT') return null;
    if (entry?.added === 'PLANNING' || (where.kind === 'listed' && where.list === 'PLANNING'))
      return out ? 'start' : null;
    if (where.kind === 'listed') return where.list !== 'COMPLETED' && out ? 'resume' : null;
    if (where.kind === 'watching') return canShow ? 'show' : null;
    if (where.kind === 'new') return out ? 'add' : 'plan';
    return null;
  }

  /**
   * Where an anime is now, as far as the page knows: where an add put it, or where it was found,
   * "Watching · episode 5 of 12" or "On your plan list"; null for one that's new to the viewer
   */
  statusFor(anime: FoundAnime, where: FoundState): string | null {
    const entry = this.entries[anime.id];
    if (entry?.added) return addedText(entry);
    if (where.kind === 'watching') return describeWatching(where.anime);
    if (where.kind === 'listed') return describeListed(where.list, this.#options.domain());
    return null;
  }

  /** Whether there's nothing left to do with it: added from here, or completed */
  done(anime: FoundAnime, where: FoundState): boolean {
    return this.isAdded(anime.id) || (where.kind === 'listed' && where.list === 'COMPLETED');
  }

  /**
   * Adds or moves an anime, `from` the list it's moved from when the page knows it; an add learns
   * where it was from the answer. A retry after the linked account missed the save keeps both
   */
  add(
    anime: FoundAnime,
    list: ListMove,
    { moved = false, from, settled }: { moved?: boolean; from?: Before; settled?: Settled } = {}
  ): SubmitFunction {
    return ({ formElement }) => {
      const previous = this.entries[anime.id];
      this.entries[anime.id] = { ...previous, saving: true, message: undefined };
      return async ({ result }) => {
        const domain = this.#options.domain();
        if (result.type === 'success') {
          const data = result.data ?? {};
          const linked = data.linked as LinkedFailure | undefined;
          const linkedBefore = isBefore(data.linkedBefore) ? data.linkedBefore : undefined;
          if (data.linkedOnly) {
            // Only the linked account was tried again: the add itself stands as it was
            this.entries[anime.id] = {
              ...previous,
              saving: false,
              linked,
              linkedBefore: linkedBefore ?? previous?.linkedBefore,
            };
            if (linkedBefore && previous?.changeId)
              updateChange(previous.changeId, { linkedBefore });
            if (!linked) this.#options.announce(`Saved on both lists: ${anime.title}`);
          } else {
            const already = data.already === true;
            const before = already ? undefined : isBefore(data.before) ? data.before : from;
            const changeId =
              already || previous?.added === list
                ? previous?.changeId
                : (recordListChange(domain, this.#options.signedIn(), {
                    kind: 'move',
                    anime: {
                      mediaId: anime.id,
                      ...(anime.malId !== null && { malId: anime.malId }),
                      title: anime.title,
                      coverUrl: anime.coverUrl,
                      isAdult: anime.isAdult,
                    },
                    before: !before || before === 'NONE' ? null : { status: before },
                    after: { status: list, progress: Number(data.progress ?? 0) },
                    ...(linkedBefore && { linkedBefore }),
                  }) ?? undefined);
            const entry: Add = {
              saving: false,
              added: list,
              already,
              moved: moved || (previous?.moved ?? false),
              before,
              linkedBefore,
              linked,
              changeId,
            };
            this.entries[anime.id] = entry;
            this.#options.announce(`${addedText(entry)}: ${anime.title}`);
            if (!already && previous?.added !== list)
              this.#options.onAdded?.(anime, list, Number(data.progress ?? 0));
          }
          await settled?.(true, formElement);
        } else {
          this.entries[anime.id] = {
            ...previous,
            saving: false,
            message:
              result.type === 'failure'
                ? String(result.data?.message ?? 'The update failed')
                : `${DOMAIN_NAMES[domain]} didn't answer, please try again`,
          };
          await settled?.(false, formElement);
        }
      };
    };
  }

  /**
   * Undoes an add: the anime goes back to where it was, which its row shows again, along with what
   * the linked account kept, if anything
   */
  undo(anime: FoundAnime, settled?: Settled): SubmitFunction {
    return ({ formElement }) => {
      const previous = this.entries[anime.id];
      this.entries[anime.id] = { ...previous, saving: true, undoing: true, message: undefined };
      return async ({ result }) => {
        if (result.type === 'success') {
          const linked = result.data?.linked as LinkedFailure | undefined;
          if (linked) this.entries[anime.id] = { saving: false, message: linked.message };
          else delete this.entries[anime.id];
          if (previous.changeId) forgetChange(previous.changeId);
          this.#options.announce(`Undone: ${anime.title}`);
          this.#options.onUndone?.(anime, previous.added!);
          await settled?.(true, formElement);
        } else {
          this.entries[anime.id] = {
            ...previous,
            saving: false,
            undoing: false,
            message:
              result.type === 'failure'
                ? String(result.data?.message ?? "The change couldn't be undone")
                : `${DOMAIN_NAMES[this.#options.domain()]} didn't answer, please try again`,
          };
          await settled?.(false, formElement);
        }
      };
    };
  }
}
