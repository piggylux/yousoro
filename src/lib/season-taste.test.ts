import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetSeasonTaste,
  forgetSeasonTastes,
  loadSeasonTaste,
  rememberTasteMove,
} from '#lib/season-taste.js';
import type { SeasonTastePageData } from '#lib/types/season.js';

const TASTE: SeasonTastePageData = {
  domain: 'anilist',
  username: 'Alice',
  canEdit: true,
  scored: 1,
  watched: 2,
  traits: [],
  listedIds: { PLANNING: [1], COMPLETED: [2] },
  watching: [{ id: 3, progress: 4, rewatching: false }],
  scores: [[2, 80]],
  mean100: 80,
};

const send = () => vi.fn(async () => Response.json(TASTE));

beforeEach(() => {
  vi.restoreAllMocks();
  forgetSeasonTastes();
});

describe("a list owner's taste, read in the browser", () => {
  it('asks once for a list, whatever the spelling, for five minutes', async () => {
    const fetcher = send();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    expect(await loadSeasonTaste('1:', 'anilist', 'Alice', fetcher)).toEqual({
      status: 'ready',
      taste: TASTE,
    });
    vi.spyOn(Date, 'now').mockReturnValue(now + 4 * 60 * 1000);
    await loadSeasonTaste('1:', 'anilist', 'alice', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/season-taste/anilist/Alice', expect.anything());

    vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000);
    await loadSeasonTaste('1:', 'anilist', 'Alice', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('never shows one viewer what was read for another, who may see private entries', async () => {
    const fetcher = send();
    await loadSeasonTaste('1:', 'anilist', 'Alice', fetcher);
    await loadSeasonTaste(null, 'anilist', 'Alice', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('says why a list is missing, and when to try again when the service is busy', async () => {
    const answer = (status: number, body: unknown) =>
      vi.fn(async () => Response.json(body, { status }));

    expect(
      await loadSeasonTaste(null, 'anilist', 'Ghost', answer(404, { message: 'No such user' }))
    ).toEqual({ status: 'missing', message: 'No such user' });
    expect(
      await loadSeasonTaste(null, 'myanimelist', 'Shy', answer(403, { message: 'Private' }))
    ).toEqual({ status: 'missing', message: 'Private' });
    expect(
      await loadSeasonTaste(null, 'anilist', 'Busy', answer(429, { message: 'Busy', retryAt: 99 }))
    ).toEqual({ status: 'busy', retryAt: 99 });
    expect(await loadSeasonTaste(null, 'anilist', 'Down', answer(502, null))).toEqual({
      status: 'failed',
    });
    // A failure isn't kept: the next visit asks again
    const fetcher = send();
    await loadSeasonTaste(null, 'anilist', 'Down', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('moves an anime added elsewhere to its new list, for every viewer, without asking again', async () => {
    const fetcher = send();
    await loadSeasonTaste('1:', 'anilist', 'Alice', fetcher);
    await loadSeasonTaste(null, 'anilist', 'Alice', fetcher);

    rememberTasteMove('anilist', 'ALICE', 1, 'CURRENT');
    rememberTasteMove('anilist', 'alice', 3, 'PLANNING');

    for (const viewer of ['1:', null]) {
      const state = await loadSeasonTaste(viewer, 'anilist', 'Alice', fetcher);
      expect(state).toMatchObject({
        taste: {
          listedIds: { PLANNING: [3], COMPLETED: [2] },
          watching: [{ id: 1, progress: 0, rewatching: false }],
        },
      });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reads a list again once its taste is forgotten, and only that list', async () => {
    const fetcher = send();
    await loadSeasonTaste(null, 'anilist', 'Alice', fetcher);
    await loadSeasonTaste(null, 'anilist', 'Bob', fetcher);

    forgetSeasonTaste('anilist', 'alice');
    await loadSeasonTaste(null, 'anilist', 'Alice', fetcher);
    await loadSeasonTaste(null, 'anilist', 'Bob', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
