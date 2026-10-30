import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AniListRateLimitError, saveEntry } from '#lib/server/anilist-client.js';
import type { EntryUpdate } from '#lib/server/entry-update.js';
import { copyToLinkedAccount } from '#lib/server/linked-save.js';
import { copyEntry, MalTokenError } from '#lib/server/myanimelist-client.js';
import type { MalSession, Session } from '#lib/server/session.js';

vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  saveEntry: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  copyEntry: vi.fn(),
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
