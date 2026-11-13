import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  afterCheck,
  canKeepSyncCheck,
  loadSyncCheck,
  reviewed,
  saveSyncCheck,
  shouldCheck,
  SYNC_CHECK_INTERVAL_MS,
  syncAccount,
  unseen,
} from '#lib/sync-check.js';

const NOW = 1_800_000_000_000;

describe('shouldCheck', () => {
  it('compares the lists again once a few hours have passed', () => {
    const check = { checkedAt: NOW, keys: [], seen: [] };

    expect(shouldCheck(check, NOW + SYNC_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(shouldCheck(check, NOW + SYNC_CHECK_INTERVAL_MS)).toBe(true);
  });

  it('compares them when they never were, or the clock was set back', () => {
    expect(shouldCheck({ checkedAt: 0, keys: [], seen: [] }, NOW)).toBe(true);
    expect(shouldCheck({ checkedAt: NOW, keys: [], seen: [] }, NOW - 1)).toBe(true);
  });
});

describe('the record of differences', () => {
  it('mentions only the differences not reviewed or dismissed yet', () => {
    expect(unseen({ checkedAt: NOW, keys: ['a', 'b', 'c'], seen: ['b'] })).toEqual(['a', 'c']);
  });

  it('forgets differences that are gone, and keeps new ones unseen', () => {
    const before = { checkedAt: 0, keys: ['a', 'b'], seen: ['a', 'b'] };

    const after = afterCheck(before, ['b', 'c'], NOW);

    expect(after).toEqual({ checkedAt: NOW, keys: ['b', 'c'], seen: ['b'] });
    expect(unseen(after)).toEqual(['c']);
  });

  it('counts every difference shown on the sync page as reviewed', () => {
    expect(unseen(reviewed(['a', 'b'], NOW))).toEqual([]);
  });
});

describe('storage', () => {
  const account = syncAccount({ id: 1 }, { id: 2 });
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a record for each pair of accounts', () => {
    saveSyncCheck(account, { checkedAt: NOW, keys: ['a'], seen: [] });

    expect(loadSyncCheck(account)).toEqual({ checkedAt: NOW, keys: ['a'], seen: [] });
    expect(loadSyncCheck(syncAccount({ id: 1 }, { id: 3 }))).toEqual({
      checkedAt: 0,
      keys: [],
      seen: [],
    });
  });

  it('starts afresh from a record it can’t read', () => {
    store.set(`yousoro:sync-check:${account}`, '{"checkedAt":"soon","keys":[1]}');

    expect(loadSyncCheck(account).checkedAt).toBe(0);
  });

  it('carries on when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });

    expect(() => saveSyncCheck(account, reviewed(['a'], NOW))).not.toThrow();
    expect(loadSyncCheck(account).checkedAt).toBe(0);
    // So the lists aren't compared at all, rather than on every visit
    expect(canKeepSyncCheck()).toBe(false);
  });

  it('can keep the record where storage works, leaving nothing behind', () => {
    expect(canKeepSyncCheck()).toBe(true);
    expect([...store.keys()]).toEqual([]);
  });
});
