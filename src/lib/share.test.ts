import { describe, expect, it, vi } from 'vitest';

import { shareLink } from '#lib/share.js';

const link = { title: "Fixture's anime list", url: 'https://yousoro.example/user/anilist/Fixture' };

function device(overrides: { touch?: boolean; share?: () => Promise<void> } = {}) {
  return {
    touch: overrides.touch ?? false,
    share: overrides.share ?? vi.fn(async () => {}),
    clipboard: { writeText: vi.fn(async () => {}) },
  };
}

describe('sharing a link', () => {
  it('opens the share sheet on touch screens', async () => {
    const phone = device({ touch: true });
    expect(await shareLink(link, phone)).toBe('shared');
    expect(phone.share).toHaveBeenCalledWith(link);
    expect(phone.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copies the link elsewhere, even where a share sheet exists', async () => {
    const desktop = device();
    expect(await shareLink(link, desktop)).toBe('copied');
    expect(desktop.share).not.toHaveBeenCalled();
    expect(desktop.clipboard.writeText).toHaveBeenCalledWith(link.url);
  });

  it('does nothing more when the viewer closes the share sheet', async () => {
    const phone = device({
      touch: true,
      share: async () => {
        throw new DOMException('Share canceled', 'AbortError');
      },
    });
    expect(await shareLink(link, phone)).toBe('cancelled');
    expect(phone.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copies the link when the share sheet fails or is missing', async () => {
    const blocked = device({
      touch: true,
      share: async () => {
        throw new DOMException('Not allowed', 'NotAllowedError');
      },
    });
    expect(await shareLink(link, blocked)).toBe('copied');
    expect(await shareLink(link, { touch: true, clipboard: blocked.clipboard })).toBe('copied');
  });

  it('opens the share sheet when the link can’t be copied', async () => {
    const share = vi.fn(async () => {});
    const blocked = { writeText: () => Promise.reject(new Error('Denied')) };
    expect(await shareLink(link, { touch: false, share, clipboard: blocked })).toBe('shared');
    expect(share).toHaveBeenCalledWith(link);
  });

  it('reports a failure when the link can neither be copied nor shared', async () => {
    expect(await shareLink(link, { touch: false })).toBe('failed');
    expect(
      await shareLink(link, {
        touch: false,
        clipboard: { writeText: () => Promise.reject(new Error('Denied')) },
      })
    ).toBe('failed');
  });
});
