<script lang="ts">
  import { imageFallback } from '#lib/image-fallback.js';

  /*
   * An anime's trailer: YouTube's still of it until it's played, and only then YouTube's player, so
   * opening an anime's details asks YouTube for nothing more than a picture. The privacy-enhanced
   * player keeps YouTube's cookies out until the video plays
   */
  type Props = {
    /** The trailer's YouTube id */
    video: string;
    /** The anime's title, to name the player by */
    title: string;
    /** Whether the still is blurred, as an adult anime's cover is */
    blurred: boolean;
  };

  let { video, title, blurred }: Props = $props();
  let playing = $state(false);
  let failed = $state(false);

  // The play button goes once pressed, so focus moves to what takes its place. It stays on this
  // page rather than in YouTube's player, where Escape would no longer reach the dialog to close
  // it; Tab goes on into the player
  const focusPlayer = (player: HTMLElement) => player.focus();
</script>

{#if playing}
  <div class="frame player" tabindex="-1" {@attach focusPlayer}>
    <!-- YouTube's player refuses to play for a page that sends no referrer -->
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video)}?autoplay=1&playsinline=1&rel=0`}
      title={`Trailer for ${title}`}
      allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen; web-share"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
  </div>
{:else}
  <button
    type="button"
    class="frame preview"
    aria-label="Play the trailer"
    title="Play the trailer"
    onclick={() => (playing = true)}
  >
    {#if !failed}
      <img
        src={`https://i.ytimg.com/vi/${encodeURIComponent(video)}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        class:blurred
        {@attach imageFallback(() => (failed = true))}
      />
    {/if}
    <span class="play" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
      </svg>
    </span>
  </button>
{/if}

<style>
  .frame {
    display: block;
    /* No taller than 45% of the screen, so a phone held sideways sees it whole in the dialog */
    width: min(100%, 80dvh);
    margin-inline: auto;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: #000;
  }

  .preview {
    position: relative;
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
  }

  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }

  /*
   * As the site's other focus outlines, but closer, inside the dialog's scrolling body, whose
   * padding leaves 3px for an outline at its edges
   */
  .preview:focus-visible,
  .player:focus-visible {
    outline: 2px solid var(--you-blue);
    outline-offset: 1px;
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    /* YouTube's still is 4:3, with bars above and below a wide video, which this crops away */
    object-fit: cover;
  }

  .blurred {
    filter: blur(16px);
    scale: 1.15;
  }

  .play {
    position: relative;
    display: grid;
    place-items: center;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.68);
    color: #fff;
    transition:
      background-color 150ms ease,
      color 150ms ease;
  }

  .play svg {
    /* The triangle's weight sits left of its box's middle */
    translate: 2px 0;
    fill: currentColor;
  }

  .preview:hover .play,
  .preview:focus-visible .play {
    background: var(--action);
    color: var(--action-content);
  }

  @media (prefers-reduced-motion: reduce) {
    .play {
      transition: none;
    }
  }
</style>
