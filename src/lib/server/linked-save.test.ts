import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListRateLimitError,
  deleteEntry as deleteAniListEntry,
  getListEntry as getAniListEntry,
  getMediaByMalIds,
  saveEntry,
  type AniListMedia,
} from '#lib/server/anilist-client.js';
import type { EntryUpdate } from '#lib/server/entry-update.js';
import {
  addDecision,
  copyToLinkedAccount,
  holdsOnlyStatus,
  moveOnLinkedAccount,
  undoOnLinkedAccount,
} from '#lib/server/linked-save.js';
import {
  copyEntry,
  deleteEntry as deleteMalEntry,
  getListEntry as getMalEntry,
  MalTokenError,
  moveToList,
} from '#lib/server/myanimelist-client.js';
import type { MalSession, Session } from '#lib/server/session.js';

vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  saveEntry: vi.fn(),
  getMediaByMalIds: vi.fn(),
  getListEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  copyEntry: vi.fn(),
  moveToList: vi.fn(),
  getListEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-auth.js', () => ({
  withMalToken: (event: { locals: App.Locals }, use: (token: string) => Promise<unknown>) =>
    use(event.locals.malSession!.token),
}));

const user = { id: 1, name: 'Fixture', avatarUrl: null };
const aniList: Session = { token: 'anilist.token.jwt', user };
const mal: MalSession = { token: 'mal-token', refreshToken: 'r', expiresAt: Infinity, user };

function signedIn(session: Session | null, malSession: MalSession | null) {
  const deleted: string[] = [];
  const cookies = { delete: (name: string) => void deleted.push(name) } as unknown as Cookies;
  return { deleted, event: { cookies, locals: { session, malSession } as App.Locals } };
}

const progress: EntryUpdate = { mediaId: 7, malId: 52991, changes: { progress: 12 } };
const scored: EntryUpdate = {
  mediaId: 7,
  malId: 52991,
  changes: { score: 85 },
  scoreFormat: 'POINT_100',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(copyEntry).mockResolvedValue();
  vi.mocked(saveEntry).mockResolvedValue({
    progress: 0,
    score: 0,
    status: 'CURRENT',
    startedAt: null,
    completedAt: null,
  });
});

describe('copyToLinkedAccount', () => {
  it('copies nothing without a linked account', async () => {
    const { event } = signedIn(aniList, null);

    expect(await copyToLinkedAccount(event, 'anilist', progress, saved(12, 0))).toBeNull();
    expect(copyEntry).not.toHaveBeenCalled();
  });

  it('copies an AniList save to MyAnimeList, as AniList left the entry', async () => {
    const { event } = signedIn(aniList, mal);

    expect(await copyToLinkedAccount(event, 'anilist', progress, saved(12, 85, 'COMPLETED'))).toBe(
      null
    );
    expect(copyEntry).toHaveBeenCalledWith('mal-token', 52991, {
      progress: 12,
      status: 'COMPLETED',
      score: undefined,
    });
  });

  it('copies the dates the save left', async () => {
    const { event } = signedIn(aniList, mal);

    await copyToLinkedAccount(event, 'anilist', progress, {
      ...saved(12, 0, 'COMPLETED'),
      startedAt: '2026-10-01',
      completedAt: '2026-10-30',
    });

    expect(copyEntry).toHaveBeenCalledWith(
      'mal-token',
      52991,
      expect.objectContaining({ startedAt: '2026-10-01', completedAt: '2026-10-30' })
    );
  });

  it('copies a new score in MyAnimeList’s whole numbers out of 10', async () => {
    const { event } = signedIn(aniList, mal);

    await copyToLinkedAccount(event, 'anilist', scored, saved(12, 85));

    expect(copyEntry).toHaveBeenCalledWith(
      'mal-token',
      52991,
      expect.objectContaining({ score: 9 })
    );
  });

  it('copies a MyAnimeList save to AniList, with the score out of 100', async () => {
    const { event } = signedIn(aniList, mal);
    const update = { ...scored, changes: { score: 8 }, scoreFormat: 'POINT_10' as const };

    await copyToLinkedAccount(event, 'myanimelist', update, saved(3, 8, 'REPEATING'));

    expect(saveEntry).toHaveBeenCalledWith('anilist.token.jwt', 7, {
      progress: 3,
      status: 'REPEATING',
      startedAt: undefined,
      completedAt: undefined,
      scoreRaw: 80,
    });
  });

  it('looks up the AniList id of an anime started from a MyAnimeList plan list, only then', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getMediaByMalIds).mockResolvedValue(
      new Map([[52991, { id: 154587 } as AniListMedia]])
    );
    const start = { malId: 52991, changes: { move: 'CURRENT' as const } };

    expect(await copyToLinkedAccount(event, 'myanimelist', start, saved(0, 0))).toBeNull();
    expect(getMediaByMalIds).toHaveBeenCalledWith([52991]);
    // Only the status: AniList's episode count and dates may be further along, and stay
    expect(saveEntry).toHaveBeenCalledWith('anilist.token.jwt', 154587, { status: 'CURRENT' });

    // A save that knows the id, as from a watching list, isn't looked up
    vi.mocked(getMediaByMalIds).mockClear();
    await copyToLinkedAccount(event, 'myanimelist', progress, saved(1, 0));
    expect(getMediaByMalIds).not.toHaveBeenCalled();
  });

  it("says when the anime isn't on AniList", async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getMediaByMalIds).mockResolvedValue(new Map());

    expect(
      await copyToLinkedAccount(
        event,
        'myanimelist',
        { malId: 1, changes: { move: 'CURRENT' } },
        saved(0, 0)
      )
    ).toEqual({ message: "Saved on MyAnimeList, but this anime isn't on AniList.", retry: false });
    expect(saveEntry).not.toHaveBeenCalled();
  });

  it('copies a start to MyAnimeList as the status alone, leaving its episode count be', async () => {
    const { event } = signedIn(aniList, mal);

    const start = { mediaId: 7, malId: 52991, changes: { move: 'CURRENT' as const } };
    expect(await copyToLinkedAccount(event, 'anilist', start, saved(0, 0))).toBeNull();
    expect(moveToList).toHaveBeenCalledWith('mal-token', 52991, 'CURRENT');
    expect(copyEntry).not.toHaveBeenCalled();
  });

  it('copies a sequel added to the plan list as the status alone, either way', async () => {
    const { event } = signedIn(aniList, mal);
    const plan = { mediaId: 7, malId: 52991, changes: { move: 'PLANNING' as const } };

    expect(await copyToLinkedAccount(event, 'anilist', plan, saved(0, 0))).toBeNull();
    expect(moveToList).toHaveBeenCalledWith('mal-token', 52991, 'PLANNING');

    expect(await copyToLinkedAccount(event, 'myanimelist', plan, saved(0, 0))).toBeNull();
    expect(saveEntry).toHaveBeenCalledWith('anilist.token.jwt', 7, { status: 'PLANNING' });
    expect(copyEntry).not.toHaveBeenCalled();
  });

  it("says when the anime isn't on MyAnimeList", async () => {
    const { event } = signedIn(aniList, mal);

    expect(
      await copyToLinkedAccount(event, 'anilist', { ...progress, malId: undefined }, saved(1, 0))
    ).toEqual({ message: "Saved on AniList, but this anime isn't on MyAnimeList.", retry: false });
  });

  it('offers to try again when the linked service is busy', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(saveEntry).mockRejectedValue(new AniListRateLimitError(30));

    expect(await copyToLinkedAccount(event, 'myanimelist', progress, saved(1, 0))).toEqual({
      message: 'Saved on MyAnimeList, but AniList is busy right now.',
      retry: true,
    });
  });

  it("signs out of the linked account alone once its sign-in can't be renewed", async () => {
    const { event, deleted } = signedIn(aniList, mal);
    vi.mocked(copyEntry).mockRejectedValue(new MalTokenError('expired'));

    const failure = await copyToLinkedAccount(event, 'anilist', progress, saved(1, 0));

    expect(failure).toMatchObject({ retry: false });
    expect(failure?.message).toContain('MyAnimeList sign-in expired');
    expect(deleted).toEqual(['session_mal']);
    expect(event.locals).toMatchObject({ session: aniList, malSession: null });
  });

  it('never throws, even on an unexpected error', async () => {
    const { event } = signedIn(aniList, mal);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(copyEntry).mockRejectedValue(new Error('boom'));

    expect(await copyToLinkedAccount(event, 'anilist', progress, saved(1, 0))).toEqual({
      message: "Saved on AniList, but MyAnimeList didn't take the update.",
      retry: true,
    });
  });
});

function saved(progress: number, score: number, status = 'CURRENT') {
  return { progress, score, status };
}

describe('adding an anime found by search', () => {
  it.each([
    [null, 'CURRENT', 'save'],
    [null, 'PLANNING', 'save'],
    // Starting a planned anime, as the plan list does
    ['PLANNING', 'CURRENT', 'save'],
    ['PLANNING', 'PLANNING', 'already'],
    ['CURRENT', 'CURRENT', 'already'],
    // Planning it again would take it off the Watching list
    ['CURRENT', 'PLANNING', 'blocked'],
    ['REPEATING', 'CURRENT', 'blocked'],
    ['COMPLETED', 'CURRENT', 'blocked'],
    ['COMPLETED', 'PLANNING', 'blocked'],
    ['PAUSED', 'CURRENT', 'blocked'],
    ['DROPPED', 'PLANNING', 'blocked'],
  ] as const)('on the list as %s, adding to %s does: %s', (listed, to, expected) => {
    expect(addDecision(listed, to)).toBe(expected);
  });

  it.each([
    // Resumed where the page saw it
    ['PAUSED', 'PAUSED', 'save'],
    ['DROPPED', 'DROPPED', 'save'],
    // Moved on since the page saw it, so it stays
    ['COMPLETED', 'PAUSED', 'blocked'],
    ['DROPPED', 'PAUSED', 'blocked'],
  ] as const)('on the list as %s, resuming one seen as %s does: %s', (listed, from, expected) => {
    expect(addDecision(listed, 'CURRENT', from)).toBe(expected);
  });

  it('only resumes to the Watching list', () => {
    expect(addDecision('PAUSED', 'PLANNING', 'PAUSED')).toBe('blocked');
  });
});

describe('moveOnLinkedAccount', () => {
  const ids = { mediaId: 7, malId: 52991 };
  const held = (status: string, progress = 0) => ({ status, progress, score: 0, rewatched: 0 });

  it('changes nothing without a linked account', async () => {
    const { event } = signedIn(aniList, null);

    expect(await moveOnLinkedAccount(event, 'anilist', ids, 'PLANNING')).toEqual({ linked: null });
    expect(getMalEntry).not.toHaveBeenCalled();
  });

  it('adds one new to the linked list, saying it was new there', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getMalEntry).mockResolvedValue(null);

    expect(await moveOnLinkedAccount(event, 'anilist', ids, 'PLANNING')).toEqual({
      linked: null,
      linkedBefore: 'NONE',
    });
    expect(moveToList).toHaveBeenCalledWith('mal-token', 52991, 'PLANNING');
  });

  it('leaves one already there as it is, with nothing to undo there', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getMalEntry).mockResolvedValue(held('PLANNING'));

    expect(await moveOnLinkedAccount(event, 'anilist', ids, 'PLANNING')).toEqual({ linked: null });
    expect(moveToList).not.toHaveBeenCalled();
  });

  it('leaves one on another list there as it is, and says so', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getAniListEntry).mockResolvedValue({
      id: 900,
      status: 'COMPLETED',
      progress: 12,
      score: 80,
      repeat: 0,
    });

    expect(await moveOnLinkedAccount(event, 'myanimelist', ids, 'PLANNING')).toEqual({
      linked: {
        message:
          'Saved on MyAnimeList, but it’s on your Completed list on AniList, so it stays there.'.replace(
            '’',
            "'"
          ),
        retry: false,
      },
    });
    expect(saveEntry).not.toHaveBeenCalled();
  });

  it('resumes one paused there too when the page saw it paused', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getMalEntry).mockResolvedValue(held('PAUSED', 4));

    expect(await moveOnLinkedAccount(event, 'anilist', ids, 'CURRENT', 'PAUSED')).toEqual({
      linked: null,
      linkedBefore: 'PAUSED',
    });
    expect(moveToList).toHaveBeenCalledWith('mal-token', 52991, 'CURRENT');
  });

  it("says when the anime isn't on the linked service, and when it's busy", async () => {
    const { event } = signedIn(aniList, mal);
    expect(await moveOnLinkedAccount(event, 'anilist', { mediaId: 7 }, 'PLANNING')).toMatchObject({
      linked: { message: "Saved on AniList, but this anime isn't on MyAnimeList.", retry: false },
    });

    vi.mocked(getMalEntry).mockRejectedValueOnce(new MalTokenError('expired'));
    const { event: expiring, deleted } = signedIn(aniList, mal);
    expect(await moveOnLinkedAccount(expiring, 'anilist', ids, 'PLANNING')).toMatchObject({
      linked: { retry: false },
    });
    expect(deleted).toEqual(['session_mal']);
  });
});

describe('undoing an add on the linked account', () => {
  const ids = { mediaId: 7, malId: 52991 };
  const held = (status: string, progress = 0, score = 0) => ({
    status,
    progress,
    score,
    rewatched: 0,
  });

  it('undoes nothing without a linked account', async () => {
    const { event } = signedIn(aniList, null);

    expect(await undoOnLinkedAccount(event, 'anilist', ids, 'PLANNING', 'NONE')).toBeNull();
    expect(getMalEntry).not.toHaveBeenCalled();
  });

  it('moves a moved anime back while it is still where the add put it', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getMalEntry).mockResolvedValue(held('CURRENT', 4));

    expect(await undoOnLinkedAccount(event, 'anilist', ids, 'CURRENT', 'PAUSED')).toBeNull();
    expect(moveToList).toHaveBeenCalledWith('mal-token', 52991, 'PAUSED');
  });

  it('takes a new anime off while its entry holds nothing but its status', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getMalEntry).mockResolvedValue(held('PLANNING'));

    expect(await undoOnLinkedAccount(event, 'anilist', ids, 'PLANNING', 'NONE')).toBeNull();
    expect(deleteMalEntry).toHaveBeenCalledWith('mal-token', 52991);
  });

  it('leaves one changed since, moved on or watched, and says so', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getAniListEntry).mockResolvedValueOnce({
      id: 900,
      status: 'COMPLETED',
      progress: 12,
      score: 80,
      repeat: 0,
    });
    vi.mocked(getAniListEntry).mockResolvedValueOnce({
      id: 900,
      status: 'PLANNING',
      progress: 0,
      score: 70,
      repeat: 0,
    });

    for (let i = 0; i < 2; i++) {
      expect(await undoOnLinkedAccount(event, 'myanimelist', ids, 'PLANNING', 'NONE')).toEqual({
        message:
          'Undone on MyAnimeList, but it has changed on AniList since, so it stays as it is there.',
        retry: false,
      });
    }
    expect(deleteAniListEntry).not.toHaveBeenCalled();
    expect(saveEntry).not.toHaveBeenCalled();
  });

  it('takes an empty AniList entry off by its own id', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getAniListEntry).mockResolvedValue({
      id: 900,
      status: 'CURRENT',
      progress: 0,
      score: 0,
      repeat: 0,
    });

    expect(await undoOnLinkedAccount(event, 'myanimelist', ids, 'CURRENT', 'NONE')).toBeNull();
    expect(deleteAniListEntry).toHaveBeenCalledWith('anilist.token.jwt', 900);
  });

  it('offers to try again when the linked service is busy, and never throws', async () => {
    const { event } = signedIn(aniList, mal);
    vi.mocked(getAniListEntry).mockRejectedValueOnce(new AniListRateLimitError(30));
    vi.mocked(getMalEntry).mockRejectedValueOnce(new Error('unexpected'));

    expect(
      await undoOnLinkedAccount(event, 'myanimelist', ids, 'CURRENT', 'PLANNING')
    ).toMatchObject({ retry: true });
    expect(await undoOnLinkedAccount(event, 'anilist', ids, 'PLANNING', 'NONE')).toMatchObject({
      message: "Undone on AniList, but MyAnimeList didn't take the update.",
    });
  });

  it.each([
    [{ progress: 0, score: 0, rewatched: 0 }, true],
    [{ progress: 1, score: 0, rewatched: 0 }, false],
    [{ progress: 0, score: 7, rewatched: 0 }, false],
    [{ progress: 0, score: 0, rewatched: 2 }, false],
  ])('treats %o as holding only its status: %s', (entry, empty) => {
    expect(holdsOnlyStatus(entry)).toBe(empty);
  });
});
