import { beforeEach, describe, expect, it, vi } from 'vitest';
let schedule: typeof import('./schedule.js');
const empty = { episodes: [], partial: false };
beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => Response.json(empty))
  );
  schedule = await import('./schedule.js');
});
describe('browser schedule cache', () => {
  it('expires a displayed fallback at its original 24-hour deadline', () => {
    const result = { episodes: [], partial: false, stale: true, fetchedAt: 1000 };
    expect(schedule.scheduleExpired(result, 86400999)).toBe(false);
    expect(schedule.scheduleExpired(result, 86401000)).toBe(true);
    expect(schedule.scheduleExpired({ ...result, stale: false }, 86401000)).toBe(false);
    expect(schedule.scheduleExpired(null, 86401000)).toBe(false);
  });
  it('coalesces identical requests regardless of ID order and reuses empty results across visits', async () => {
    await Promise.all([
      schedule.loadSchedule([2, 1, 1], 10, 20),
      schedule.loadSchedule([1, 2], 10, 20),
    ]);
    await schedule.loadSchedule([1, 2], 10, 20);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).mediaIds).toEqual([1, 2]);
  });
  it('refreshes complete results after one hour and isolates date ranges', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await schedule.loadSchedule([1], 10, 20);
    await schedule.loadSchedule([1], 20, 30);
    vi.spyOn(Date, 'now').mockReturnValue(now + 3600000);
    await schedule.loadSchedule([1], 10, 20);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('splits only at 500 IDs and skips empty lists', async () => {
    await schedule.loadSchedule([], 10, 20);
    expect(fetch).not.toHaveBeenCalled();
    await schedule.loadSchedule(
      Array.from({ length: 501 }, (_, i) => i + 1),
      10,
      20
    );
    expect(
      vi.mocked(fetch).mock.calls.map((call) => JSON.parse(call[1]!.body as string).mediaIds.length)
    ).toEqual([500, 1]);
  });
  it('reuses partial results briefly without treating them as complete and allows a retry', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ episodes: [], partial: true, partialReason: 'unavailable' })
    );
    expect((await schedule.loadSchedule([1], 10, 20)).partial).toBe(true);
    expect((await schedule.loadSchedule([1], 10, 20)).partial).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(now + 30000);
    expect((await schedule.loadSchedule([1], 10, 20)).partial).toBe(false);
    await schedule.loadSchedule([1], 10, 20, true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('retries an incomplete batch immediately without reloading complete batches', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(empty))
      .mockResolvedValueOnce(
        Response.json({ episodes: [], partial: true, partialReason: 'unavailable' })
      );
    await schedule.loadSchedule(ids, 10, 20);
    await schedule.loadSchedule(ids, 10, 20, true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string).mediaIds).toEqual([501]);
  });
  it('respects Retry-After for retries and other lookups', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'Retry-After': '20' } })
    );
    await expect(schedule.loadSchedule([1], 10, 20)).rejects.toMatchObject({
      retryAt: now + 20000,
    });
    await expect(schedule.loadSchedule([2], 10, 20, true)).rejects.toMatchObject({
      retryAt: now + 20000,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(now + 20000);
    await schedule.loadSchedule([1], 10, 20);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('preserves earlier batches if a later batch fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ episodes: [{ mediaId: 1, episode: 3, airsAt: 100 }], partial: false })
      )
      .mockRejectedValueOnce(new Error('offline'));
    expect(
      await schedule.loadSchedule(
        Array.from({ length: 501 }, (_, i) => i + 1),
        10,
        20
      )
    ).toMatchObject({
      episodes: [{ mediaId: 1, episode: 3, airsAt: 100 }],
      partial: true,
      partialReason: 'unavailable',
    });
  });
  it('does not cache network failures as empty schedules', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(schedule.loadSchedule([1], 10, 20)).rejects.toBeInstanceOf(
      schedule.ScheduleUnavailable
    );
    await schedule.loadSchedule([1], 10, 20);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('uses a labelled stale fallback for 24 hours without extending its life after failed refreshes', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        episodes: [{ mediaId: 1, episode: 3, airsAt: 100 }],
        partial: false,
        fetchedAt: now,
      })
    );
    await schedule.loadSchedule([1], 10, 20);
    vi.spyOn(Date, 'now').mockReturnValue(now + 3600000);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    expect(await schedule.loadSchedule([1], 10, 20)).toMatchObject({
      stale: true,
      fetchedAt: now,
      episodes: [{ mediaId: 1, episode: 3, airsAt: 100 }],
    });
    await schedule.loadSchedule([1], 10, 20);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.spyOn(Date, 'now').mockReturnValue(now + 86400000);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(schedule.loadSchedule([1], 10, 20)).rejects.toBeInstanceOf(
      schedule.ScheduleUnavailable
    );
  });
  it('never treats a server fallback as freshly fetched or extends its original age', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetchedAt = now - 86390000;
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ episodes: [], partial: true, stale: true, fetchedAt })
    );
    expect(await schedule.loadSchedule([1], 10, 20)).toMatchObject({ stale: true, fetchedAt });
    vi.spyOn(Date, 'now').mockReturnValue(now + 10000);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(schedule.loadSchedule([1], 10, 20)).rejects.toBeInstanceOf(
      schedule.ScheduleUnavailable
    );
  });
  it('lets a successful retry replace stale data', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await schedule.loadSchedule([1], 10, 20);
    vi.spyOn(Date, 'now').mockReturnValue(now + 3600000);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    expect((await schedule.loadSchedule([1], 10, 20)).stale).toBe(true);
    const fresh = await schedule.loadSchedule([1], 10, 20, true);
    expect(fresh.stale).toBeUndefined();
    expect(fresh.fetchedAt).toBe(now + 3600000);
  });
});
