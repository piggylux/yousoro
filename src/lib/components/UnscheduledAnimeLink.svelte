<script lang="ts">
  import type { Anime } from '#lib/types/anime.js';

  let { anime, blurMature = true }: { anime: Anime; blurMature?: boolean } = $props();
  let failed = $state(false);
  $effect(() => {
    void anime.thumbnailUrl;
    failed = false;
  });
  const status = $derived(
    {
      FINISHED: 'Finished airing',
      HIATUS: 'On hiatus',
      CANCELLED: 'Cancelled',
      NOT_YET_RELEASED: 'Not yet aired',
      RELEASING: 'No date in this window',
    }[anime.status] ?? 'No date in this window'
  );
</script>

<a
  href={`https://anilist.co/anime/${anime.id}`}
  target="_blank"
  rel="noopener noreferrer"
  title={anime.title}
>
  <span class="poster" class:blurred={anime.isAdult && blurMature}>
    {#if anime.thumbnailUrl && !failed}
      <img src={anime.thumbnailUrl} alt="" loading="lazy" onerror={() => (failed = true)} />
    {:else}<span class="initial" aria-hidden="true">{anime.title.charAt(0)}</span>{/if}
    {#if anime.isAdult && blurMature}<span class="mature">18+</span>{/if}
  </span>
  <span class="copy">
    <strong>{anime.title}</strong>
    <span>{status}{anime.rewatching ? ' · Rewatching' : ''}</span>
  </span>
  <span class="arrow" aria-hidden="true">↗</span>
  <span class="tw:sr-only">Opens on AniList in a new tab</span>
</a>

<style>
  a {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    height: 100%;
    padding: 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--color-base-content);
  }
  a:hover {
    border-color: var(--you-blue);
    background: var(--you-blue-pale);
  }
  a:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 3px;
  }
  .poster {
    position: relative;
    flex: none;
    width: 42px;
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
  .initial,
  .mature {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-weight: 800;
  }
  .initial {
    color: var(--text-accent);
  }
  .mature {
    color: white;
    font-size: 0.65rem;
    text-shadow: 0 1px 4px black;
  }
  .copy {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    flex: 1;
  }
  strong {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
    color: var(--text-heading);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .copy > span {
    color: var(--text-accent);
    font-size: 0.7rem;
  }
  .arrow {
    color: var(--text-accent);
    flex: none;
  }
</style>
