import { describeScore, type ScoreFormat } from '#lib/score.js';
import type { Before, BeforeFinish } from '#lib/types/api.js';
import { LIST_NAMES, listPath, type Domain } from '#lib/types/domain.js';
import type { SessionUser } from '#lib/types/session-user.js';

/*
 * The changes the user made to their lists in this tab, newest first, so they can revert one from
 * the Recent changes page. Kept in the tab's session storage: a reload keeps them, closing the tab
 * doesn't, and signing out of a service drops that account's. Storage can be missing or refuse, in
 * which case nothing is kept
 */

/** The fields of an entry a change touched, in AniList's terms and the owner's score format */
export type ChangeFields = { status?: string; progress?: number; score?: number };

/** The signed-in account whose list was changed */
export type ChangeAccount = { domain: Domain; id: number; name: string };

export type ListChange = {
  id: string;
  /** When it was saved, as Unix time in ms */
  at: number;
  /**
   * A save of the episode count or score ('entry'), a move from one list to another or onto the
   * list, as Start watching or an add from the search ('move'), or Remove from the plan list
   */
  kind: 'entry' | 'move' | 'remove';
  account: ChangeAccount;
  anime: {
    /** AniList's id; left out of a MyAnimeList plan list's anime, which aren't matched to AniList */
    mediaId?: number;
    malId?: number;
    title: string;
    coverUrl: string | null;
    isAdult: boolean;
  };
  /** The score format both scores are in, when the change touched the score */
  scoreFormat?: ScoreFormat;
  /** Null when it wasn't on the list */
  before: ChangeFields | null;
  /** Null when it was taken off the list */
  after: ChangeFields | null;
  /** What the entry held before a save finished the anime */
  beforeFinish?: BeforeFinish;
  /**
   * Where the anime was on the linked account before a move, which reverting it puts it back to: as
   * an add from the search found it there, or Planning for a start from the plan list, which the
   * linked account copied. Left out when the move didn't change the linked account, which reverting
   * then leaves as it is
   */
  linkedBefore?: Before;
  /** Remove took it off the linked account's plan list too */
  linkedRemoved?: true;
};

export type NewChange = Omit<ListChange, 'id' | 'at'>;

type ReadStorage = Pick<Storage, 'getItem'> | null;
type WriteStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

const KEY = 'yousoro:changes';
export const MAX_CHANGES = 100;

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isChange(value: unknown): value is ListChange {
  if (!value || typeof value !== 'object') return false;
  const change = value as Partial<ListChange>;
  return (
    typeof change.id === 'string' &&
    typeof change.at === 'number' &&
    (change.kind === 'entry' || change.kind === 'move' || change.kind === 'remove') &&
    typeof change.account?.id === 'number' &&
    typeof change.account.name === 'string' &&
    typeof change.anime?.title === 'string'
  );
}

/** Every change kept, newest first */
export function listChanges(storage: ReadStorage = sessionStore()): ListChange[] {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter(isChange) : [];
  } catch {
    return [];
  }
}

function write(changes: ListChange[], storage: WriteStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(changes.slice(0, MAX_CHANGES)));
  } catch {
    // Not kept: the history goes without it
  }
}

const sameFields = (a: ChangeFields | null, b: ChangeFields | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Keeps a change the user just saved, first; returns its id, or null when it changed nothing. The
 * oldest go once there are more than MAX_CHANGES
 */
export function recordChange(
  change: NewChange,
  storage: WriteStorage = sessionStore(),
  now = Date.now()
): string | null {
  if (sameFields(change.before, change.after)) return null;
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  write([{ ...change, id, at: now }, ...listChanges(storage)], storage);
  return id;
}

/** Adds what a later answer said about a change, as where a retry found it on the linked account */
export function updateChange(
  id: string,
  update: Partial<Pick<ListChange, 'linkedBefore' | 'linkedRemoved'>>,
  storage: WriteStorage = sessionStore()
) {
  const changes = listChanges(storage);
  if (!changes.some((change) => change.id === id)) return;
  write(
    changes.map((change) => (change.id === id ? { ...change, ...update } : change)),
    storage
  );
}

/**
 * Takes a change off the history once it's reverted, from the history or the Undo beside it where it
 * was made: there's nothing left to revert. Returns the changes kept
 */
export function forgetChange(id: string, storage: WriteStorage = sessionStore()): ListChange[] {
  const changes = listChanges(storage);
  const kept = changes.filter((change) => change.id !== id);
  if (kept.length !== changes.length) write(kept, storage);
  return kept;
}

const accountKey = ({ domain, id }: Pick<ChangeAccount, 'domain' | 'id'>) => `${domain}:${id}`;

/**
 * Drops the changes of accounts no longer signed in, as after signing out of a service: they're
 * that account's to see. Returns the changes kept
 */
export function pruneChanges(
  accounts: Pick<ChangeAccount, 'domain' | 'id'>[],
  storage: WriteStorage = sessionStore()
): ListChange[] {
  const signedIn = new Set(accounts.map(accountKey));
  const changes = listChanges(storage);
  const kept = changes.filter((change) => signedIn.has(accountKey(change.account)));
  if (kept.length !== changes.length) write(kept, storage);
  return kept;
}

/** The signed-in account a change to a list on `domain` is made on, or null when there's none */
export function accountFor(
  domain: Domain,
  user: SessionUser | null | undefined,
  malUser: SessionUser | null | undefined
): ChangeAccount | null {
  const owner = domain === 'anilist' ? user : malUser;
  return owner ? { domain, id: owner.id, name: owner.name } : null;
}

/** Who is signed in, as the layout's data says */
type SignedIn = { user?: SessionUser | null; malUser?: SessionUser | null };

/**
 * Keeps a change the user just saved to their own list on `domain`, which is always the signed-in
 * account's there; returns its id, or null when nobody is signed in there or nothing changed
 */
export function recordListChange(
  domain: Domain,
  { user, malUser }: SignedIn,
  change: Omit<NewChange, 'account'>,
  storage: WriteStorage = sessionStore()
): string | null {
  const account = accountFor(domain, user, malUser);
  return account ? recordChange({ ...change, account }, storage) : null;
}

/** What a save of the episode count or score changed, as the card that saved it knows */
export type SavedChange = Pick<ListChange, 'before' | 'after' | 'beforeFinish'> & {
  before: ChangeFields;
  after: ChangeFields;
};

/** An entry's fields as a save of the episode count or score found them, or left them */
type SavedFields = { status: string; progress: number; score: number };

/**
 * What a save changed, in the fields it changed alone: as the card saw them when it was sent, and
 * as the service saved them. The score only counts when the save set it (`scored`), so a score
 * changed elsewhere meanwhile isn't taken for this save's
 */
export function savedChange(
  before: SavedFields,
  after: SavedFields,
  scored: boolean,
  beforeFinish?: BeforeFinish
): SavedChange {
  const names = (['status', 'progress', 'score'] as const).filter(
    (name) => (name !== 'score' || scored) && before[name] !== after[name]
  );
  const pick = (entry: SavedFields): ChangeFields =>
    Object.fromEntries(names.map((name) => [name, entry[name]]));
  return { before: pick(before), after: pick(after), ...(beforeFinish && { beforeFinish }) };
}

/*
 * Each anime on each account's list is changed in turn, so it's reverted the other way: only its
 * latest change, and the one before once that's reverted. An anime is known by its id on the list's
 * own service, as a MyAnimeList plan list doesn't know AniList's
 */
function animeKey({ account, anime }: ListChange) {
  return `${accountKey(account)}:${account.domain === 'myanimelist' ? anime.malId : anime.mediaId}`;
}

/**
 * Whether a change can be reverted now ('revertible'), or waits on a later change of the same anime
 * being reverted first ('later'). `changes` are those left to revert, newest first
 */
export function revertState(change: ListChange, changes: ListChange[]): 'revertible' | 'later' {
  const key = animeKey(change);
  const latest = changes.find((other) => animeKey(other) === key);
  return latest?.id === change.id ? 'revertible' : 'later';
}

/** What a change did, in a sentence or two for the history */
export function describeChange(change: ListChange): string[] {
  const { kind, before, after, account, scoreFormat } = change;
  const lists = LIST_NAMES[account.domain];
  if (kind === 'remove' || !after) return ['Removed from your plan list'];
  if (kind === 'move') {
    if (after.status === 'PLANNING') return ['Added to your plan list'];
    if (!before) return [`Added to ${lists.CURRENT}`];
    if (before.status === 'PLANNING') return ['Started watching (was planned)'];
    return [`Started watching again (was ${lists[before.status!] ?? before.status})`];
  }

  const lines: string[] = [];
  if (after.progress !== undefined && before?.progress !== undefined) {
    const finished = after.status === 'COMPLETED' && before.status !== 'COMPLETED';
    const rewatch = before.status === 'REPEATING';
    if (finished) {
      lines.push(
        `${rewatch ? 'Finished rewatching' : 'Finished'} at episode ${after.progress} (was ${before.progress})`
      );
    } else if (after.progress === before.progress + 1) {
      lines.push(`Watched episode ${after.progress}`);
    } else if (after.progress > before.progress) {
      lines.push(`Watched up to episode ${after.progress} (was ${before.progress})`);
    } else {
      lines.push(`Set back to episode ${after.progress} (was ${before.progress})`);
    }
  }
  if (after.score !== undefined && before?.score !== undefined && scoreFormat) {
    const score = (value: number) => (value ? describeScore(value, scoreFormat) : 'not scored');
    lines.push(
      after.score
        ? `Scored ${score(after.score)} (was ${score(before.score)})`
        : `Took the score off (was ${score(before.score)})`
    );
  }
  return lines;
}

/**
 * The form that reverts a change, by the action that undoes it on the account's list: the history's
 * own for a save of the episode count or score, and the Undo a move or a removal already has, which
 * also checks the anime is still where the change left it, there and on the linked account
 */
export function revertForm(change: ListChange): { action: string; fields: Record<string, string> } {
  const { kind, account, anime, before, after } = change;
  const path = listPath(account.domain, account.name);
  const ids: Record<string, string> = {
    ...(anime.mediaId !== undefined && { mediaId: String(anime.mediaId) }),
    ...(anime.malId !== undefined && { malId: String(anime.malId) }),
  };
  if (kind === 'remove') {
    return {
      action: `${path}/planning?/undoRemove`,
      fields: { ...ids, ...(change.linkedRemoved && { linkedRemoved: 'true' }) },
    };
  }
  if (kind === 'move') {
    return {
      action: `${path}?/undoAdd`,
      fields: {
        ...ids,
        list: after!.status!,
        before: (before?.status as Before | undefined) ?? 'NONE',
        ...(after?.progress !== undefined && { progress: String(after.progress) }),
        ...(change.linkedBefore && { linkedBefore: change.linkedBefore }),
      },
    };
  }
  return {
    action: `${path}?/revertEntry`,
    fields: {
      ...ids,
      before: JSON.stringify(before),
      after: JSON.stringify(after),
      ...(change.scoreFormat && { scoreFormat: change.scoreFormat }),
      ...(change.beforeFinish && { beforeFinish: JSON.stringify(change.beforeFinish) }),
    },
  };
}
