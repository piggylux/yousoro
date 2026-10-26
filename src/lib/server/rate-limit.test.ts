import { beforeEach, describe, expect, it, vi } from 'vitest';

let limits: typeof import('./rate-limit.js');
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  limits = await import('./rate-limit.js');
});

describe('per-instance rate limits', () => {
  it('charges weighted costs and allows a fresh window after expiry', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect((await limits.takeLimit('page:fixture', 12, 60, 5)).allowed).toBe(true);
    expect((await limits.takeLimit('page:fixture', 12, 60, 5)).allowed).toBe(true);
    expect(await limits.takeLimit('page:fixture', 12, 60, 5)).toEqual({
      allowed: false,
      retryAfter: 60,
    });
    expect((await limits.takeLimit('page:fixture', 12, 60, 2)).allowed).toBe(true);
    expect((await limits.takeLimit('page:other', 12, 60, 5)).allowed).toBe(true);
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    expect((await limits.takeLimit('page:fixture', 12, 60, 5)).allowed).toBe(true);
  });

  it('bounds counters without evicting active limits, then reclaims expired entries', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let i = 0; i < 1000; i++) {
      expect((await limits.takeLimit(`fixture:${i}`, 1)).allowed).toBe(true);
    }
    expect((await limits.takeLimit('overflow', 1)).allowed).toBe(false);
    expect((await limits.takeLimit('fixture:0', 1)).allowed).toBe(false);
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    expect((await limits.takeLimit('overflow', 1)).allowed).toBe(true);
  });

  it('caps outbound calls and never shortens an active cooldown', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await limits.pauseAniList(45);
    await limits.pauseAniList(10);
    expect(await limits.takeAniListRequest()).toEqual({ allowed: false, retryAfter: 45 });
    vi.spyOn(Date, 'now').mockReturnValue(now + 45_000);
    for (let i = 0; i < 25; i++) {
      expect((await limits.takeAniListRequest()).allowed).toBe(true);
    }
    expect((await limits.takeAniListRequest()).allowed).toBe(false);
  });
});
