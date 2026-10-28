import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

import FriendAvatar from '#lib/components/FriendAvatar.svelte';
import ScheduledEpisodeLink from '#lib/components/ScheduledEpisodeLink.svelte';
import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
import UnscheduledAnimeLink from '#lib/components/UnscheduledAnimeLink.svelte';
import { imageFallback } from '#lib/image-fallback.js';
import type { Anime } from '#lib/types/anime.js';

class ImageStub extends EventTarget {
  complete = false;
  naturalWidth = 0;
}

describe('image fallback', () => {
  it('handles a failure after attachment and removes the listener on cleanup', () => {
    const image = new ImageStub();
    const failed = vi.fn();
    const cleanup = imageFallback(failed)(image as unknown as HTMLImageElement);
    expect(failed).not.toHaveBeenCalled();
    image.dispatchEvent(new Event('error'));
    expect(failed).toHaveBeenCalledOnce();
    cleanup?.();
    image.dispatchEvent(new Event('error'));
    expect(failed).toHaveBeenCalledOnce();
  });

  it('recovers a failure that occurred before hydration', () => {
    const image = new ImageStub();
    image.complete = true;
    const failed = vi.fn();
    imageFallback(failed)(image as unknown as HTMLImageElement)?.();
    expect(failed).toHaveBeenCalledOnce();
  });

  it('keeps a successfully loaded image', () => {
    const image = new ImageStub();
    image.complete = true;
    image.naturalWidth = 100;
    const failed = vi.fn();
    imageFallback(failed)(image as unknown as HTMLImageElement)?.();
    expect(failed).not.toHaveBeenCalled();
  });
});

const anime: Anime = {
  id: 1,
  title: 'Test anime',
  englishTitle: null,
  otherTitles: [],
  thumbnailUrl: '/cover.png',
  status: 'FINISHED',
  isAdult: false,
  meanScore: null,
  userScore: null,
  currentEpisode: 1,
  rewatching: false,
  lastUpdatedAt: null,
  nextEpisode: null,
  recentEpisodeAiredAt: null,
  numberAiredEpisodes: 12,
  endDate: new Date('2026-01-01'),
  numberEpisodes: 12,
};

describe('image fallback SSR under the script CSP', () => {
  const cases = [
    [
      'avatar',
      () => render(FriendAvatar, { props: { id: 1, name: 'Friend', avatarUrl: '/avatar.png' } }),
    ],
    ['unscheduled cover', () => render(UnscheduledAnimeLink, { props: { anime } })],
    [
      'scheduled cover',
      () => render(ScheduledEpisodeLink, { props: { entry: { anime, episode: 2, airsAt: 0 } } }),
    ],
    [
      'shared poster',
      () =>
        render(SharedAnimePoster, {
          props: { anime: { ...anime, coverUrl: '/cover.png', progress: 1 } },
        }),
    ],
  ] as const;

  it.each(cases)('renders %s without executable event attributes', (_name, renderComponent) => {
    const { body } = renderComponent();
    expect(body).toContain('<img');
    expect(body).not.toMatch(/\son[a-z]+\s*=/i);
  });
});
