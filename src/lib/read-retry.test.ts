import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let retry: typeof import('./read-retry.js');
let hidden = false;
let documentEvents: EventTarget;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ now: 1000 });
  hidden = false;
  documentEvents = new EventTarget();
  Object.defineProperty(documentEvents, 'hidden', { get: () => hidden });
  vi.stubGlobal('document', documentEvents);
  retry = await import('./read-retry.js');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('bounded automatic read recovery', () => {
  it('honors numeric and HTTP-date cooldowns without shortening long waits', () => {
    expect(retry.retryAfterSeconds('900')).toBe(900);
    expect(retry.retryAfterSeconds('Thu, 01 Jan 1970 00:00:21 GMT')).toBe(20);
    expect(retry.retryAfterSeconds(null)).toBe(60);
    expect(retry.retryAfterSeconds('invalid')).toBe(60);
  });
  it('never retries before the cooldown and allows only two automatic attempts', async () => {
    const callback = vi.fn();
    retry.queueReadRetry('list', 11000, callback);
    await vi.advanceTimersByTimeAsync(10000);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    retry.queueReadRetry('list', Date.now() + 1000, callback);
    await vi.advanceTimersByTimeAsync(2000);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(retry.queueReadRetry('list', Date.now() + 1000, callback)).toBeNull();
    retry.clearReadRetries('list');
    expect(retry.queueReadRetry('list', Date.now() + 1000, callback)?.attempt).toBe(1);
  });
  it('defers overdue retries until the tab is visible', async () => {
    const callback = vi.fn();
    hidden = true;
    retry.queueReadRetry('friends', 2000, callback);
    await vi.advanceTimersByTimeAsync(60000);
    expect(callback).not.toHaveBeenCalled();
    hidden = false;
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(callback).toHaveBeenCalledTimes(1);
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(callback).toHaveBeenCalledTimes(1);
  });
  it('cancels obsolete work without spending an attempt', async () => {
    const callback = vi.fn();
    retry.queueReadRetry('old-account', 2000, callback)?.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(callback).not.toHaveBeenCalled();
    expect(retry.queueReadRetry('old-account', Date.now() + 1000, callback)?.attempt).toBe(1);
  });
  it('coalesces duplicate retry triggers and scopes budgets by context', async () => {
    const first = vi.fn(),
      second = vi.fn(),
      other = vi.fn();
    retry.queueReadRetry('same', 2000, first);
    retry.queueReadRetry('same', 2000, second);
    retry.queueReadRetry('other', 2000, other);
    await vi.advanceTimersByTimeAsync(3000);
    expect(first.mock.calls.length + second.mock.calls.length).toBe(1);
    expect(other).toHaveBeenCalledTimes(1);
  });
  it('invalidates older queued timers when a recovered read clears its budget', async () => {
    const obsolete = vi.fn(),
      current = vi.fn();
    retry.queueReadRetry('recovered', 2000, obsolete);
    retry.clearReadRetries('recovered');
    retry.queueReadRetry('recovered', 2000, current);
    await vi.advanceTimersByTimeAsync(3000);
    expect(obsolete).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });
  it('does not reset the budget during a long Retry-After wait', async () => {
    const callback = vi.fn();
    retry.queueReadRetry('long', 901000, callback);
    await vi.advanceTimersByTimeAsync(902000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(retry.queueReadRetry('long', Date.now() + 900000, callback)?.attempt).toBe(2);
    await vi.advanceTimersByTimeAsync(901000);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(retry.queueReadRetry('long', Date.now() + 1000, callback)).toBeNull();
  });
});
