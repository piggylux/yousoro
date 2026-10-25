import { describe, expect, it } from 'vitest';

import {
  AIRING_SLACK_MS,
  nextAiringReloadDelay,
  planReload,
  RETURN_RELOAD_AFTER_MS,
  reloadsOnReturn,
} from '#lib/live-updates.js';
import type { Anime } from '#lib/types/anime.js';

const now = Date.UTC(2026, 9, 25, 12);
const minutes = (n: number) => n * 60 * 1000;

// Only the next episode matters here
const airing = (airsAt: number | null) =>
  ({ nextEpisode: airsAt === null ? null : { number: 5, airsAt } }) as Anime;

describe('nextAiringReloadDelay', () => {
  it('waits for the soonest episode to air, and a minute more', () => {
    const list = [airing(now + minutes(30)), airing(now + minutes(10)), airing(null)];
    expect(nextAiringReloadDelay(list, now)).toBe(minutes(10) + AIRING_SLACK_MS);
  });

  it('has nothing to wait for when no episode is scheduled', () => {
    expect(nextAiringReloadDelay([airing(null)], now)).toBeNull();
    expect(nextAiringReloadDelay([], now)).toBeNull();
  });

  it('reloads soon for an episode that aired moments ago', () => {
    expect(nextAiringReloadDelay([airing(now - minutes(0.5))], now)).toBe(AIRING_SLACK_MS);
  });

  it('skips an episode that aired a while ago, which AniList hasn’t caught up with', () => {
    const list = [airing(now - minutes(5)), airing(now + minutes(20))];
    expect(nextAiringReloadDelay(list, now)).toBe(minutes(20) + AIRING_SLACK_MS);
  });

  it('stays within what a timer can wait', () => {
    const inAYear = now + 365 * 24 * minutes(60);
    expect(nextAiringReloadDelay([airing(inAYear)], now)).toBe(2 ** 31 - 1);
  });
});

describe('planReload', () => {
  it('reloads now when the viewer is free and the tab is visible', () => {
    expect(planReload({ hidden: false, busy: false })).toBe('now');
  });

  it('waits while the viewer is busy, so nothing they type is lost', () => {
    expect(planReload({ hidden: false, busy: true })).toBe('later');
  });

  it('waits for a hidden tab to be visible again, busy or not', () => {
    expect(planReload({ hidden: true, busy: false })).toBe('when-visible');
    expect(planReload({ hidden: true, busy: true })).toBe('when-visible');
  });
});

describe('reloadsOnReturn', () => {
  it('reloads when a reload waited for the tab to be visible', () => {
    expect(reloadsOnReturn({ waiting: true, loadedAt: now, now })).toBe(true);
  });

  it('reloads a list loaded long enough ago, not a fresh one', () => {
    const loadedAt = now - RETURN_RELOAD_AFTER_MS;
    expect(reloadsOnReturn({ waiting: false, loadedAt: loadedAt - 1, now })).toBe(true);
    expect(reloadsOnReturn({ waiting: false, loadedAt, now })).toBe(false);
    expect(reloadsOnReturn({ waiting: false, loadedAt: now - minutes(1), now })).toBe(false);
  });
});
