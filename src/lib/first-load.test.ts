import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { PAGE_LOAD_WAIT_MS, STILL_READING, stillReading, within } from '#lib/first-load.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const after = <T>(ms: number, settle: (resolve: (value: T) => void, reject: () => void) => void) =>
  new Promise<T>((resolve, reject) => setTimeout(() => settle(resolve, reject), ms));

describe('within', () => {
  it('answers with the read when it finishes in time', async () => {
    const pending = within(after<string>(1000, (resolve) => resolve('list')));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe('list');
  });

  it('stops waiting once the time is up, and a read failing after that goes unnoticed', async () => {
    const pending = within(after(PAGE_LOAD_WAIT_MS + 500, (_, reject) => reject()));
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS);
    expect(await pending).toBe(STILL_READING);
    // An unhandled rejection here would fail the test run
    await vi.advanceTimersByTimeAsync(500);
  });
});

describe('stillReading', () => {
  it('answers with a 503 saying the page is on its way', () => {
    let thrown: unknown;
    try {
      stillReading('AniList', 'The planning list');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({
      status: 503,
      body: {
        message:
          'AniList is taking longer than usual to answer. The planning list will appear as soon as it does.',
        loading: true,
      },
    });
  });
});
