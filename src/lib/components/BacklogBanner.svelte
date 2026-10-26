<script lang="ts">
  import { onMount } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion, Tween } from 'svelte/motion';

  import { getBacklog, getNextUp } from '#lib/anime.js';
  import { clock } from '#lib/clock.js';
  import { formatAirsIn } from '#lib/countdown.js';
  import type { Anime } from '#lib/types/anime.js';

  type Props = {
    animeList: Anime[];
    username: string;
    /** Speaks to the visitor on their own list, and about the owner on anyone else's */
    isOwnList: boolean;
  };

  let { animeList, username, isOwnList }: Props = $props();

  const backlog = $derived(getBacklog(animeList));
  const mood = $derived(
    animeList.length === 0 ? 'empty' : backlog.episodes === 0 ? 'caught-up' : 'behind'
  );

  // Starts at the real total, then counts smoothly to the new one after each progress update
  const shownEpisodes = Tween.of(() => backlog.episodes, {
    duration: () => (prefersReducedMotion.current ? 0 : 800),
    easing: cubicOut,
  });

  function plural(count: number, word: string) {
    return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
  }

  // When all caught up: the next episode to air across the list
  const nextUp = $derived(getNextUp(animeList));
  // The countdown uses the viewer's clock and time zone, so it only appears once in the browser
  let mounted = $state(false);
  onMount(() => (mounted = true));

  const episodesWord = $derived(backlog.episodes === 1 ? 'episode' : 'episodes');
  const animeCount = $derived(backlog.anime === 1 ? 'on 1 anime' : `across ${backlog.anime} anime`);

  // The animated version is hidden from screen readers, which get this once per change instead
  const summary = $derived.by(() => {
    const who = isOwnList ? "You're" : `${username} is`;
    switch (mood) {
      case 'empty':
        return isOwnList
          ? 'Your watching list is empty.'
          : `${username} isn't watching anything right now.`;
      case 'caught-up':
        // No countdown here: it would change right after the page loads and be announced
        return (
          `${who} all caught up!` +
          (nextUp ? ` Next up: ${nextUp.anime.title}, episode ${nextUp.episode}.` : '')
        );
      default:
        return (
          `${who} ${plural(backlog.episodes, 'episode')} behind ${animeCount}. ` +
          `Biggest backlog: ${backlog.biggest?.anime.title}, ${plural(backlog.biggest?.episodes ?? 0, 'episode')} left.`
        );
    }
  });
</script>

<section class="banner {mood}">
  <p class="tw:sr-only" role="status">{summary}</p>

  <div class="content" aria-hidden="true">
    {#if mood === 'behind'}
      <span class="count">{Math.round(shownEpisodes.current).toLocaleString()}</span>
      <div>
        <p class="headline">
          {isOwnList
            ? `${episodesWord} to catch up on`
            : `${episodesWord} for ${username} to catch up on`}
        </p>
        <p class="detail">
          {animeCount}
          {#if backlog.biggest}
            · most from <strong>{backlog.biggest.anime.title}</strong> ({backlog.biggest.episodes})
          {/if}
        </p>
      </div>
    {:else if mood === 'caught-up'}
      <span class="count celebrate">⚓</span>
      <div>
        <!-- "Yousoro!", You Watanabe's sailor's call, which the app is named after -->
        <p class="headline">
          ヨーソロー! {isOwnList ? "You're all caught up!" : `${username} is all caught up!`}
        </p>
        <p class="detail">
          {#if nextUp}
            Next up: <strong>{nextUp.anime.title}</strong> ep {nextUp.episode}
            {#if mounted}{formatAirsIn(nextUp.airsAt, clock.now)}{/if}
          {:else}
            {isOwnList
              ? 'Every aired episode watched. Enjoy the break until the next one drops.'
              : 'Every aired episode watched.'}
          {/if}
        </p>
      </div>
    {:else}
      <div>
        <p class="headline">Nothing to watch yet</p>
        <p class="detail">
          {isOwnList
            ? 'Start an anime on AniList and it will show up here.'
            : `${username} isn't watching anything right now.`}
        </p>
      </div>
    {/if}
  </div>
</section>

<style>
  /* The blues come from the app theme in app.css; sky blue is only the accent bar and border */
  .banner {
    --accent: var(--you-blue);
    flex: 0 1 40rem;
    max-width: 100%;
    padding: 12px 18px;
    border: 1px solid var(--border-subtle);
    border-left: 4px solid var(--accent);
    border-radius: var(--radius-box, 1rem);
    background: var(--you-blue-pale);
    color: var(--text-heading);
    box-shadow: 0 1px 3px rgb(15 61 110 / 0.08);
    /* The layout adapts to the banner's own width, wherever the page puts it */
    container-type: inline-size;
  }

  .empty {
    --accent: var(--color-base-300);
    border-color: var(--color-base-300);
    background: var(--color-base-100);
  }

  .content {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .count {
    flex: none;
    color: var(--text-accent);
    font-size: 1.75rem;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .headline {
    font-weight: 600;
    /* Even lines, so a word like "on" is never left alone on the last one */
    text-wrap: balance;
  }

  .detail {
    font-size: 0.85rem;
    color: var(--text-accent);
  }

  /*
   * On a narrow banner (phones), the count and the headline share the first line and the detail
   * gets the full width below, instead of the count floating beside a tall block of text
   */
  @container (max-width: 30rem) {
    .banner {
      padding: 10px 14px;
    }

    .behind .content,
    .caught-up .content {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: baseline;
      column-gap: 10px;
      row-gap: 4px;
    }

    .behind .content > div,
    .caught-up .content > div {
      display: contents;
    }

    .count {
      font-size: 1.5rem;
    }

    .detail {
      grid-column: 1 / -1;
      /* A long anime title can't make the banner grow taller than two detail lines */
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
  }

  .celebrate {
    animation: celebrate 0.8s ease-out;
  }

  @keyframes celebrate {
    0% {
      transform: scale(0.6) rotate(-15deg);
    }
    60% {
      transform: scale(1.15) rotate(8deg);
    }
    100% {
      transform: scale(1) rotate(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .celebrate {
      animation: none;
    }
  }
</style>
