import { afterEach, describe, expect, it, vi } from 'vitest';

import { consumeSavedCounts, rememberSavedCounts } from './saved-counts.js';

afterEach(() => vi.restoreAllMocks());

describe('confirmed progress feedback', () => {
  it('waits for confirmed progress and survives card replacement, then plays once', () => {
    rememberSavedCounts(1, { progress: 3, backlog: 2 }, 4);
    expect(consumeSavedCounts(1, { progress: 3, backlog: 2 })).toBeNull();
    expect(consumeSavedCounts(1, { progress: 4, backlog: 1 })).toEqual({
      gain: 1,
      backlogDecreased: true,
      caughtUp: false,
    });
    expect(consumeSavedCounts(1, { progress: 4, backlog: 1 })).toBeNull();
  });

  it('shows progress feedback without a caught-up splash when no backlog was known', () => {
    rememberSavedCounts(2, { progress: 3, backlog: 0 }, 4);
    expect(consumeSavedCounts(2, { progress: 4, backlog: 0 })).toEqual({
      gain: 1,
      backlogDecreased: false,
      caughtUp: false,
    });
  });

  it('celebrates catching up and reports the actual size of a larger progress update', () => {
    rememberSavedCounts(3, { progress: 3, backlog: 4 }, 7);
    expect(consumeSavedCounts(3, { progress: 7, backlog: 0 })).toEqual({
      gain: 4,
      backlogDecreased: true,
      caughtUp: true,
    });
  });

  it('does not celebrate lower progress or unchanged progress', () => {
    rememberSavedCounts(4, { progress: 3, backlog: 0 }, 2);
    expect(consumeSavedCounts(4, { progress: 2, backlog: 1 })).toEqual({
      gain: 0,
      backlogDecreased: false,
      caughtUp: false,
    });
    rememberSavedCounts(4, { progress: 2, backlog: 1 }, 2);
    expect(consumeSavedCounts(4, { progress: 2, backlog: 1 })).toBeNull();
  });

  it('expires unconsumed feedback so returning to a removed card does not replay it', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    rememberSavedCounts(5, { progress: 3, backlog: 1 }, 4);
    vi.mocked(Date.now).mockReturnValue(6000);
    expect(consumeSavedCounts(5, { progress: 4, backlog: 0 })).toBeNull();
  });

  it('uses only the latest confirmed save when updates arrive before a card renders', () => {
    rememberSavedCounts(6, { progress: 3, backlog: 3 }, 4);
    rememberSavedCounts(6, { progress: 4, backlog: 2 }, 5);
    expect(consumeSavedCounts(6, { progress: 4, backlog: 2 })).toBeNull();
    expect(consumeSavedCounts(6, { progress: 5, backlog: 1 })).toEqual({
      gain: 1,
      backlogDecreased: true,
      caughtUp: false,
    });
  });
});
