<script lang="ts">
  import type { CalendarEpisode } from '#lib/calendar.js';
  import { clock } from '#lib/clock.js';
  let { entry, blurMature = true }: { entry: CalendarEpisode; blurMature?: boolean } = $props();
  const aired = $derived(entry.airsAt <= clock.now);
  let failed = $state(false);
  $effect(() => {
    void entry.anime.thumbnailUrl;
    failed = false;
  });
</script>

<a
  class:aired
  href={`https://anilist.co/anime/${entry.anime.id}`}
  target="_blank"
  rel="noopener noreferrer"
  title={entry.anime.title}
>
  <span class="poster" class:blurred={entry.anime.isAdult && blurMature}>
    {#if !failed}<img
        src={entry.anime.thumbnailUrl}
        alt=""
        loading="lazy"
        onerror={() => (failed = true)}
      />{:else}<span class="fallback" aria-hidden="true">{entry.anime.title.charAt(0)}</span>{/if}
    {#if entry.anime.isAdult && blurMature}<span class="mature">18+</span>{/if}
  </span>
  <span class="info">
    <time datetime={new Date(entry.airsAt).toISOString()}
      >{new Date(entry.airsAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })}</time
    >
    <span class="title">{entry.anime.title}</span>
    <span class="episode"
      >Episode {entry.episode}{entry.anime.rewatching ? ' · Rewatching' : ''}</span
    >
  </span>
  <span class="tw:sr-only">{aired ? 'Already aired. ' : ''}Opens on AniList in a new tab</span>
</a>

<style>
  a {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: var(--radius-control);
    color: var(--color-base-content);
    text-decoration: none;
    min-width: 0;
    transition: background 150ms ease;
  }
  a:hover {
    background: var(--you-blue-pale);
  }
  a:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }
  .aired .poster {
    filter: grayscale(1);
    opacity: 0.65;
  }
  .aired .info,
  .aired time {
    color: color-mix(in srgb, var(--color-base-content) 65%, var(--surface));
  }
  .poster {
    position: relative;
    flex: none;
    display: block;
    width: 38px;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: 7px;
    background: var(--you-blue-pale);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .blurred img {
    filter: blur(16px);
    scale: 1.2;
  }
  .mature,
  .fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 0.65rem;
    font-weight: 800;
  }
  .mature {
    color: white;
    text-shadow: 0 1px 4px black;
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 3px;
  }
  time {
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--text-accent);
  }
  .title {
    font-size: 0.8rem;
    font-weight: 750;
    line-height: 1.4;
    /* Keep episode blocks aligned whether the title uses one line or two. */
    min-height: 2lh;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .episode {
    font-size: 0.7rem;
    opacity: 0.7;
  }
  @media (prefers-reduced-motion: reduce) {
    a {
      transition: none;
    }
  }
</style>
