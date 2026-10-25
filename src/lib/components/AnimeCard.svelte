<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { onMount } from 'svelte';

  import { getEpisodesToWatch, getWatchState, type WatchState } from '#lib/anime.js';
  import { clock } from '#lib/clock.js';
  import { formatAirDate, formatAirsIn } from '#lib/countdown.js';
  import type { Anime } from '#lib/types/anime.js';

  type Props = {
    anime: Anime;
    animeLinkFn: (animeId: number) => string;
    /** Whether the signed-in user can update this anime's progress */
    canEdit?: boolean;
    /** Called when a progress update catches the user up on this anime, or finishes it */
    onCaughtUp?: (kind: 'caught-up' | 'completed', anime: Anime) => void;
  };

  let { anime, animeLinkFn, canEdit = false, onCaughtUp }: Props = $props();

  // Countdowns use the viewer's clock and time zone, so they only appear once in the browser
  let mounted = $state(false);
  onMount(() => (mounted = true));

  const countdown = $derived.by(() => {
    if (!mounted || !anime.nextEpisode) return null;
    const { number, airsAt } = anime.nextEpisode;
    const airsIn = formatAirsIn(airsAt, clock.now);
    return {
      label: `Ep ${number} ${airsIn}`,
      spoken: `Caught up. Episode ${number} airs ${airsIn}`,
      date: `Episode ${number} airs ${formatAirDate(airsAt)}`,
    };
  });

  // Both services report 0 episodes while the total isn't known yet
  const totalEpisodes = $derived(anime.numberEpisodes || null);
  const progressLabel = $derived(`${anime.currentEpisode} / ${totalEpisodes ?? '?'}`);
  const episodesToWatch = $derived(getEpisodesToWatch(anime));
  const watchState = $derived(getWatchState(anime));

  // Badges for anime whose aired episode count isn't known
  const NO_EPISODE_INFO: Partial<Record<WatchState, { label: string; title: string }>> = {
    'next-episode-unscheduled': {
      label: 'Next episode TBA',
      title: "Still airing, but the next episode isn't scheduled yet",
    },
    hiatus: { label: 'On hiatus', title: 'Airing is paused for now' },
    'not-aired': { label: 'Not aired yet', title: "The first episode hasn't aired yet" },
    cancelled: { label: 'Cancelled', title: 'The show was cancelled before it finished' },
  };
  const noEpisodeInfo = $derived(NO_EPISODE_INFO[watchState]);

  // Widths in % of the total for the progress bar's watched and aired-but-unwatched parts
  const barParts = $derived.by(() => {
    if (!totalEpisodes) return null;
    const watched = Math.min(anime.currentEpisode, totalEpisodes);
    const aired = Math.min(watched + episodesToWatch, totalEpisodes) - watched;
    return {
      watched: (watched / totalEpisodes) * 100,
      aired: (aired / totalEpisodes) * 100,
      description:
        `${watched} of ${totalEpisodes} watched` +
        (aired > 0 ? `, ${aired} aired episode${aired === 1 ? '' : 's'} left` : ''),
    };
  });

  let modal = $state<HTMLDialogElement>();
  let saving = $state(false);
  let errorMessage = $state<string | null>(null);

  function openModal() {
    modal?.showModal();
  }

  const submitProgress: SubmitFunction = () => {
    saving = true;
    errorMessage = null;
    const stateBefore = watchState;

    return async ({ result, update }) => {
      saving = false;
      if (result.type === 'failure') {
        errorMessage = (result.data?.message as string | undefined) ?? 'The update failed';
        return;
      }
      if (result.type === 'success') {
        modal?.close();

        // Celebrate only the moment the user catches up or finishes, judged by what AniList saved
        const saved = Number(result.data?.progress);
        const stateAfter = getWatchState({ ...anime, currentEpisode: saved });
        const wasDone = stateBefore === 'caught-up' || stateBefore === 'completed';
        if (!wasDone && (stateAfter === 'caught-up' || stateAfter === 'completed')) {
          onCaughtUp?.(stateAfter, anime);
        }
      }
      // Reloads the list, so the card shows what AniList saved
      await update({ reset: false });
    };
  };
</script>

<div class="card-slot tw:indicator tw:h-full">
  <!-- Every badge sits in the same place, centered on top of the card, so they're easy to scan -->
  {#if watchState === 'completed'}
    <span class="card-badge tw:indicator-item tw:indicator-center tw:badge tw:badge-success"
      >✓ Completed</span
    >
  {:else if watchState === 'caught-up'}
    <span
      class="card-badge tw:indicator-item tw:indicator-center tw:badge tw:badge-success"
      title={countdown?.date}
      aria-label={countdown?.spoken}
    >
      ✓ {countdown?.label ?? 'Caught up'}
    </span>
  {:else if noEpisodeInfo}
    <span
      class="card-badge tw:indicator-item tw:indicator-center tw:badge tw:badge-neutral"
      title={noEpisodeInfo.title}
    >
      {noEpisodeInfo.label}
    </span>
  {:else if watchState === 'to-watch'}
    <span
      class="card-badge tw:indicator-item tw:indicator-center tw:badge behind-badge"
      aria-label={`${episodesToWatch} episode${episodesToWatch === 1 ? '' : 's'} to watch`}
    >
      {episodesToWatch.toLocaleString()} behind
    </span>
  {/if}
  <div class="anime-card tw:card tw:shadow-xl">
    <button class="cover" onclick={openModal}>
      <img src={anime.thumbnailUrl} alt={anime.title} class:up-to-date={episodesToWatch === 0} />
      <!-- Always two lines tall, so every card is the same height; the full title shows on hover -->
      <span class="title tw:text-center tw:font-bold tw:line-clamp-2" title={anime.title}
        >{anime.title}</span
      >
    </button>
    <div class="progression">
      {#if totalEpisodes && barParts}
        <!-- Watched, then aired but not watched yet, then not aired yet -->
        <div
          class="episode-bar"
          role="progressbar"
          aria-label="Episode progress"
          aria-valuemin={0}
          aria-valuemax={totalEpisodes}
          aria-valuenow={Math.min(anime.currentEpisode, totalEpisodes)}
          aria-valuetext={barParts.description}
        >
          <span class="watched" style:width="{barParts.watched}%"></span>
          <span class="aired" style:width="{barParts.aired}%"></span>
        </div>
      {/if}
      <span class="tw:text-sm tw:opacity-70">{progressLabel}</span>
      {#if canEdit}
        <form method="POST" action="?/updateProgress" use:enhance={submitProgress}>
          <input type="hidden" name="mediaId" value={anime.id} />
          <input type="hidden" name="progress" value={anime.currentEpisode + 1} />
          <button
            class="tw:btn tw:btn-primary tw:btn-xs"
            disabled={saving || watchState === 'completed'}
            aria-label={`Mark episode ${anime.currentEpisode + 1} of ${anime.title} as watched`}
          >
            {#if saving}<span class="tw:loading tw:loading-spinner tw:loading-xs"
              ></span>{:else}+1{/if}
          </button>
        </form>
      {/if}
    </div>
    {#if errorMessage}
      <p class="tw:text-error tw:text-xs" role="alert">{errorMessage}</p>
    {/if}
  </div>
</div>

<dialog bind:this={modal} class="tw:modal">
  <div class="tw:modal-box">
    <a
      class="tw:font-bold tw:text-lg tw:link tw:link-hover"
      href={animeLinkFn(anime.id)}
      target="_blank">{anime.title}</a
    >
    <p class="tw:py-4">Progression: {progressLabel}</p>
    {#if canEdit}
      <form class="tw:join" method="POST" action="?/updateProgress" use:enhance={submitProgress}>
        <input type="hidden" name="mediaId" value={anime.id} />
        <input
          class="tw:input tw:input-bordered tw:input-sm tw:join-item tw:w-24"
          type="number"
          name="progress"
          min="0"
          max={totalEpisodes ?? undefined}
          value={anime.currentEpisode}
          aria-label="Episodes watched"
          required
        />
        <button class="tw:btn tw:btn-primary tw:btn-sm tw:join-item" disabled={saving}>Save</button>
      </form>
      {#if errorMessage}
        <p class="tw:text-error tw:text-sm tw:pt-2" role="alert">{errorMessage}</p>
      {/if}
    {/if}
  </div>
  <form method="dialog" class="tw:modal-backdrop">
    <button>close</button>
  </form>
</dialog>

<style>
  .anime-card {
    /* Set by the page grid, which sizes cards to fit the screen */
    width: var(--card-width, 300px);
    max-width: 100%;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: #ffffff;
  }

  .cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
    cursor: pointer;
  }

  .title {
    min-height: 2lh;
  }

  .progression {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    /* Keeps the progress row at the bottom when a card is stretched to match its neighbours */
    margin-top: auto;
  }

  .progression > span {
    margin-left: auto;
    white-space: nowrap;
  }

  .episode-bar {
    display: flex;
    flex: 1;
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    /* Not aired yet */
    background: var(--you-blue-pale);
    box-shadow: inset 0 0 0 1px #cdeafd;
  }

  .episode-bar .watched {
    background: var(--sea-blue);
  }

  /* Aired but not watched yet: the backlog the badge counts */
  .episode-bar .aired {
    background: var(--you-blue);
  }

  /* A white ring and a shadow lift every badge off the cover and the card */
  .card-badge {
    height: 1.75rem;
    padding: 0 0.85rem;
    border: 2px solid #ffffff;
    font-size: 0.85rem;
    font-weight: 800;
    box-shadow: 0 4px 10px rgb(0 0 0 / 0.2);
    /* `scale` rather than `transform`, which daisyUI uses to position the badge */
    animation: badge-pop 0.45s ease-out;
  }

  /* The badge to act on stands out most. White on these blues keeps at least 4.5:1 contrast */
  .behind-badge {
    background: linear-gradient(135deg, #1872b8, var(--sea-blue));
    color: #ffffff;
    box-shadow:
      0 4px 12px rgb(20 95 156 / 0.45),
      0 0 0 3px rgb(73 185 249 / 0.35);
    /* Keeps the gleam inside the pill */
    overflow: hidden;
  }

  /*
   * A light gleam sweeps across every few seconds. All badges sweep together, so the grid
   * shimmers calmly instead of flickering
   */
  .behind-badge::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      110deg,
      transparent 30%,
      rgb(255 255 255 / 0.5) 50%,
      transparent 70%
    );
    translate: -100% 0;
    animation: gleam 4s ease-in-out 1s infinite;
    pointer-events: none;
  }

  @keyframes gleam {
    0% {
      translate: -100% 0;
    }
    /* The sweep takes the first 30%; the rest of the cycle is a pause */
    30%,
    100% {
      translate: 100% 0;
    }
  }

  @keyframes badge-pop {
    0% {
      scale: 0.4;
      opacity: 0;
    }
    60% {
      scale: 1.15;
      opacity: 1;
    }
    100% {
      scale: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card-badge {
      animation: none;
    }

    .behind-badge::after {
      display: none;
    }
  }

  .card-slot:hover {
    animation: 0.2s pulse forwards;
  }

  /* Every cover gets the same 3:4 frame, cropped to fit, whatever the image's own proportions */
  img {
    border-radius: var(--rounded-box, 1rem) var(--rounded-box, 1rem) 0 0;
    width: 100%;
    aspect-ratio: 3 / 4;
    object-fit: cover;
  }

  @keyframes pulse {
    0% {
      transform: scale(1);
    }

    100% {
      transform: scale(1.03);
    }
  }
</style>
