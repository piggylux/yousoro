import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let count: typeof import('./notification-count.svelte.js');
let hidden = false;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ now: 1_000_000 });
  hidden = false;
  vi.stubGlobal('document', {
    get hidden() {
      return hidden;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ unread: 3 }))
  );
  count = await import('./notification-count.svelte.js');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** An answer from the server that arrives when the test says so */
function answerLater() {
  let answer!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () => new Promise<Response>((resolve) => (answer = resolve))
  );
  return (response: Response) => answer(response);
}

describe('the unread notification count', () => {
  it('asks nothing until an AniList account is signed in', async () => {
    await count.refreshUnread();
    expect(fetch).not.toHaveBeenCalled();
    expect(count.notificationCount.unread).toBe(0);
  });

  it('asks AniList at most once a minute', async () => {
    count.resetForUser(1);
    await count.refreshUnread();
    expect(count.notificationCount.unread).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(59_000);
    await count.refreshUnread();
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    await count.refreshUnread();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('waits while the tab is hidden, without using up the minute', async () => {
    count.resetForUser(1);
    hidden = true;
    await count.refreshUnread();
    expect(fetch).not.toHaveBeenCalled();

    hidden = false;
    await count.refreshUnread();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares a request already on its way', async () => {
    count.resetForUser(1);
    await Promise.all([count.refreshUnread(), count.refreshUnread()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the count it had when AniList is busy, the sign-in ran out, or the answer is odd', async () => {
    count.resetForUser(1);
    await count.refreshUnread();
    for (const response of [
      new Response('busy', { status: 429 }),
      new Response(null, { status: 204 }),
      Response.json({ unread: -1 }),
      Response.json({ unread: 'many' }),
    ]) {
      vi.advanceTimersByTime(60_000);
      vi.mocked(fetch).mockResolvedValueOnce(response);
      await count.refreshUnread();
      expect(count.notificationCount.unread).toBe(3);
    }
    vi.advanceTimersByTime(60_000);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
    await count.refreshUnread();
    expect(count.notificationCount.unread).toBe(3);
  });

  it('drops a count asked for before the notifications were read', async () => {
    count.resetForUser(1);
    const answer = answerLater();
    const asked = count.refreshUnread();
    count.markAllRead();
    answer(Response.json({ unread: 5 }));
    await asked;
    expect(count.notificationCount.unread).toBe(0);

    // Reading them counts as a check, so the bell doesn't ask again straight away
    await count.refreshUnread();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('starts over for another account, dropping the last one’s answer', async () => {
    count.resetForUser(1);
    await count.refreshUnread();
    expect(count.notificationCount.unread).toBe(3);

    const answer = answerLater();
    vi.advanceTimersByTime(60_000);
    const asked = count.refreshUnread();
    count.resetForUser(2);
    expect(count.notificationCount.unread).toBe(0);
    answer(Response.json({ unread: 9 }));
    await asked;
    expect(count.notificationCount.unread).toBe(0);

    // The new account's count is asked for straight away
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ unread: 1 }));
    await count.refreshUnread();
    expect(count.notificationCount.unread).toBe(1);
  });

  it('asks nothing once signed out', async () => {
    count.resetForUser(1);
    count.resetForUser(null);
    await count.refreshUnread();
    expect(fetch).not.toHaveBeenCalled();
  });
});
