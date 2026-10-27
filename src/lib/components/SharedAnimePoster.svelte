<script lang="ts">
  import type { SharedAnime } from '#lib/types/friend-watching.js';
  let {
    anime,
    blurMature = true,
    compact = false,
  }: {
    anime: SharedAnime & { progress: number; rewatching: boolean };
    blurMature?: boolean;
    compact?: boolean;
  } = $props();
  let failed = $state(false);
  $effect(() => {
    void anime.coverUrl;
    failed = false;
  });
</script>

<a
  class:compact
  href={`https://anilist.co/anime/${anime.id}`}
  target="_blank"
  rel="noopener noreferrer"
  title={`${anime.title} · Episode ${anime.progress}${anime.rewatching ? ' · Rewatching' : ''} · Opens in a new tab`}
  aria-label={`${anime.title}, episode ${anime.progress}${anime.rewatching ? ', rewatching' : ''}, opens in a new tab`}
  style={`--poster-hue: ${(anime.id * 31 + 195) % 360}`}
>
  {#if anime.coverUrl && !failed}
    <img
      src={anime.coverUrl}
      alt=""
      loading="lazy"
      class:blurred={anime.isAdult && blurMature}
      onerror={() => (failed = true)}
    />
  {:else}<span class="poster-initial" aria-hidden="true">{anime.title.charAt(0)}</span>{/if}
  <span class="episode">{anime.rewatching ? '↻ ' : ''}Ep {anime.progress}</span>
  {#if anime.isAdult && blurMature}<span class="mature">18+</span>{/if}
  <span class="poster-title">{anime.title}</span>
</a>

<style>
  .compact {
    border-radius: 6px;
  }
  .compact .poster-title,
  .compact .episode {
    display: none;
  }
  .compact::after {
    display: none;
  }
  a {
    position: relative;
    display: block;
    overflow: hidden;
    aspect-ratio: 3 / 4;
    border-radius: 10px;
    background: linear-gradient(
      155deg,
      hsl(var(--poster-hue) 50% 55%),
      hsl(calc(var(--poster-hue) + 45) 35% 25%)
    );
    color: white;
    box-shadow: 0 4px 10px rgb(9 30 57 / 0.12);
    transition:
      translate 180ms ease,
      box-shadow 180ms ease;
  }
  a::after {
    content: '';
    position: absolute;
    inset: 25% 0 0;
    background: linear-gradient(transparent, rgb(5 15 31 / 0.9));
    pointer-events: none;
  }
  a:hover {
    translate: 0 -4px;
    box-shadow: 0 8px 18px rgb(9 30 57 / 0.22);
  }
  a:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 3px;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .blurred {
    filter: blur(16px);
    scale: 1.15;
  }
  .poster-initial {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: 2rem;
    font-weight: 800;
    opacity: 0.5;
  }
  .poster-title {
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    z-index: 1;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.68rem;
    line-height: 1.3;
    font-weight: 700;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
  }
  .episode {
    position: absolute;
    top: 6px;
    right: 6px;
    border: 1px solid rgb(255 255 255 / 0.2);
    border-radius: 6px;
    padding: 2px 5px;
    background: rgb(9 23 44 / 0.75);
    color: white;
    font-size: 0.6rem;
    font-weight: 700;
    backdrop-filter: blur(8px);
  }
  .mature {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 0.8rem;
    font-weight: 800;
  }
  @media (prefers-reduced-motion: reduce) {
    a {
      transition: none;
    }
    a:hover {
      translate: none;
    }
  }
</style>
