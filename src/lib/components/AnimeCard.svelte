<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { onMount, tick } from 'svelte';

  import { getEpisodesToWatch, getWatchState, type WatchState } from '#lib/anime.js';
  import { clock } from '#lib/clock.js';
  import { formatAirDate, formatAirsIn } from '#lib/countdown.js';
  import { nyaaSearchUrl, nyaaSite } from '#lib/nyaa.js';
  import type { Anime } from '#lib/types/anime.js';
  import type { DownloadLanguage, DownloadVersion } from '#lib/types/preferences.js';

  type Props = {
    anime: Anime;
    animeLinkFn: (animeId: number) => string;
    /** Whether the signed-in user can update this anime's progress */
    canEdit?: boolean;
    /** Called when a progress update catches the user up on this anime, or finishes it */
    onCaughtUp?: (kind: 'caught-up' | 'completed', anime: Anime) => void;
    /** The viewer's setting: blur covers of anime AniList marks as adult */
    blurMature?: boolean;
    /** The viewer's setting: which releases the nyaa.si search looks for */
    downloadLanguage?: DownloadLanguage;
    /** The viewer's setting: subbed, dubbed or dual-audio releases for that search */
    downloadVersion?: DownloadVersion;
  };

  let {
    anime,
    animeLinkFn,
    canEdit = false,
    onCaughtUp,
    blurMature = true,
    downloadLanguage = 'any',
    downloadVersion = 'any',
  }: Props = $props();

  const coverBlurred = $derived(anime.isAdult && blurMature);

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
  // The next episode to watch, when it has already aired; only offered on the viewer's own list
  const nextToWatch = $derived(canEdit && episodesToWatch > 0 ? anime.currentEpisode + 1 : null);

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

  let saving = $state(false);

  // The episode count typed on the card's back; it resets to the saved count whenever that changes
  let watchedDraft = $derived<number | null>(anime.currentEpisode);
  const watchedChanged = $derived(watchedDraft !== null && watchedDraft !== anime.currentEpisode);
  let errorMessage = $state<string | null>(null);

  // The card flips over to show its details, instead of opening a popup
  let flipped = $state(false);
  let coverButton = $state<HTMLButtonElement>();
  let backFace = $state<HTMLElement>();

  // Focus follows the side that's showing, so keyboard users land on what they can see
  async function flip(showBack: boolean) {
    flipped = showBack;
    if (!showBack) {
      // Turning back over discards an unsaved edit and any error, so the next flip starts fresh
      watchedDraft = anime.currentEpisode;
      errorMessage = null;
    }
    await tick();
    // Without scrolling: the card is already where the user is looking, even if partly off screen
    const options = { preventScroll: true };
    if (showBack) backFace?.querySelector<HTMLElement>('a, button, input')?.focus(options);
    else coverButton?.focus(options);
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
        if (flipped) await flip(false);

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

<!-- Esc turns the card back over while focus is on its back -->
<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && flipped && backFace?.contains(document.activeElement))
      flip(false);
  }}
/>

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
  {:else if watchState === 'to-watch' && anime.rewatching}
    <!-- A rewatch isn't "behind": its episodes aren't new, so it gets a calmer badge -->
    <span
      class="card-badge tw:indicator-item tw:indicator-center tw:badge rewatch-badge"
      title="Rewatching"
      aria-label={`Rewatching, ${episodesToWatch} episode${episodesToWatch === 1 ? '' : 's'} left`}
    >
      ↻ {episodesToWatch.toLocaleString()} left
    </span>
  {:else if watchState === 'to-watch'}
    <span
      class="card-badge tw:indicator-item tw:indicator-center tw:badge behind-badge"
      aria-label={`${episodesToWatch} episode${episodesToWatch === 1 ? '' : 's'} to watch`}
    >
      {episodesToWatch.toLocaleString()} behind
    </span>
  {/if}
  <div class="anime-card" class:flipped>
    <!--
      A click anywhere on the card turns it over, except on its links, buttons and forms. It's
      handled here rather than on each side, so it works mid-turn too: the side being left is
      already inert. Keyboard users have the cover button, so the click needs no key equivalent.
    -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="flipper"
      onclick={(event) => {
        const target = event.target as Element;
        if (!target.closest('a, button, input, label, form')) flip(!flipped);
      }}
    >
      <!-- Only the side facing the viewer can be focused or read by a screen reader -->
      <div class="face front tw:card tw:shadow-xl" inert={flipped}>
        <button
          class="cover"
          bind:this={coverButton}
          onclick={() => flip(true)}
          aria-label={`${anime.title}, show details`}
        >
          <!-- Clips the cover's hover zoom to its frame -->
          <span class="cover-frame" class:mature={coverBlurred}>
            <img
              src={anime.thumbnailUrl}
              alt=""
              loading="lazy"
              class:up-to-date={episodesToWatch === 0}
            />
            <span class="wave" aria-hidden="true"></span>
            {#if coverBlurred}
              <span class="mature-label">18+</span>
            {/if}
          </span>
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
        {#if errorMessage && !flipped}
          <!-- Over the cover rather than below it, so every card keeps the same height -->
          <p class="front-error tw:text-error tw:text-xs" role="alert">{errorMessage}</p>
        {/if}
      </div>

      <!--
        The back: the details the popup used to show. Keyboard and screen reader users turn it back
        over with Esc
      -->
      <div
        class="face back tw:card tw:shadow-xl"
        bind:this={backFace}
        inert={!flipped}
        role="group"
        aria-label={`${anime.title} details`}
        aria-keyshortcuts="Escape"
      >
        <!-- Always three lines tall, so the details sit at the same height on every card -->
        <a class="back-title" href={animeLinkFn(anime.id)} target="_blank" title={anime.title}>
          {anime.title}<span class="tw:sr-only">, on AniList, opens in a new tab</span>
        </a>

        <dl class="facts">
          <dt>Watched</dt>
          <dd>
            {#if canEdit}
              <!-- The count itself is the field: change it and Save, or press Enter -->
              <form
                class="watched-form"
                method="POST"
                action="?/updateProgress"
                use:enhance={submitProgress}
              >
                <input type="hidden" name="mediaId" value={anime.id} />
                <input
                  class="tw:input tw:input-xs tw:w-16"
                  type="number"
                  name="progress"
                  min="0"
                  max={totalEpisodes ?? undefined}
                  bind:value={watchedDraft}
                  aria-label="Episodes watched"
                  required
                />
                <span>/ {totalEpisodes ?? '?'}</span>
                <button
                  class="tw:btn tw:btn-primary tw:btn-xs"
                  disabled={saving || !watchedChanged}
                >
                  Save
                </button>
              </form>
            {:else}
              {progressLabel}
            {/if}
          </dd>
          {#if anime.numberAiredEpisodes}
            <dt>Aired</dt>
            <dd>{anime.numberAiredEpisodes.toLocaleString()}</dd>
          {/if}
          {#if anime.rewatching}
            <dt>Status</dt>
            <dd>Rewatching</dd>
          {/if}
          {#if mounted && anime.nextEpisode}
            <dt>Next</dt>
            <dd>Ep {anime.nextEpisode.number}, {formatAirDate(anime.nextEpisode.airsAt)}</dd>
          {/if}
        </dl>

        <!-- Pinned to the bottom, so errors line up across cards too -->
        <div class="back-actions">
          {#if nextToWatch}
            <a
              class="download-link"
              href={nyaaSearchUrl({
                title: anime.title,
                englishTitle: anime.englishTitle,
                otherTitles: anime.otherTitles,
                episode: nextToWatch,
                language: downloadLanguage,
                version: downloadVersion,
                adult: anime.isAdult,
              })}
              target="_blank"
              rel="noreferrer"
            >
              Find episode {nextToWatch} on {nyaaSite(anime.isAdult)}<span class="tw:sr-only"
                >, opens in a new tab</span
              >
            </a>
          {/if}
          {#if errorMessage && flipped}
            <p class="tw:text-error tw:text-sm" role="alert">{errorMessage}</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .anime-card {
    /* Set by the page grid, which sizes cards to fit the screen */
    width: var(--card-width, 300px);
    max-width: 100%;
    /* Gives the flip its depth */
    perspective: 1200px;
    /* Clicking turns the card over, so a quick double click shouldn't select its text */
    user-select: none;
  }

  /* The episode count field stays editable like any other */
  .anime-card input {
    user-select: text;
  }

  /* Both sides turn together; the front sets the card's height and the back sits behind it */
  .flipper {
    position: relative;
    height: 100%;
    transform-style: preserve-3d;
    transition: transform 0.6s cubic-bezier(0.2, 0.7, 0.2, 1);
  }

  .flipped .flipper {
    transform: rotateY(180deg);
  }

  /*
   * As a hint that the card turns over, hovering it starts to turn it and lets it settle back, as a
   * light gleam sweeps across. The turn uses `rotate`, separate from the flip's `transform`, so a
   * click mid-hint still flips the card smoothly. It ends flat, so the text ends sharp
   */
  .card-slot:hover .flipper {
    animation: peek 0.6s ease-in-out;
  }

  @keyframes peek {
    45% {
      rotate: y -12deg;
    }
  }

  .front::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(
        105deg,
        transparent 35%,
        rgb(255 255 255 / 0.45) 50%,
        transparent 65%
      )
      100% 0 / 250% 100% no-repeat;
    pointer-events: none;
  }

  .card-slot:hover .front::after {
    animation: gleam-sweep 0.7s ease-out;
  }

  @keyframes gleam-sweep {
    to {
      background-position: 0 0;
    }
  }

  .face {
    height: 100%;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: #ffffff;
    backface-visibility: hidden;
    transition: box-shadow 0.2s ease-out;
  }

  /*
   * Sea glow: on hover, or when a keyboard user is on the card, a sky-blue glow rings it, the cover
   * brightens and a wave rolls along its bottom edge. Nothing moves or scales, so it stays sharp
   */
  .card-slot:hover .face,
  .card-slot:has(:focus-visible) .face {
    box-shadow:
      0 0 0 2px var(--you-blue),
      0 10px 28px -6px rgb(73 185 249 / 0.55);
  }

  /* A fixed layout from the top: title, details, then any error at the bottom */
  .back {
    position: absolute;
    inset: 0;
    justify-content: flex-start;
    gap: 16px;
    padding: 20px 16px;
    overflow-y: auto;
    text-align: center;
    transform: rotateY(180deg);
    /* The details adapt to the card's own width, which the page grid sets */
    container-type: inline-size;
  }

  /*
   * The pointer is set on the turning container, not on each side, so it stays while the card
   * turns, when the side being left is already inert. Forms keep the usual cursor
   */
  .flipper {
    cursor: pointer;
  }

  .flipper form {
    cursor: auto;
  }

  .back-title {
    display: -webkit-box;
    flex: none;
    height: 3lh;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    color: var(--navy);
    font-size: 1.05rem;
    font-weight: 800;
    line-height: 1.3;
  }

  .back-title:hover,
  .back-title:focus-visible {
    color: var(--sea-blue);
    text-decoration: underline;
  }

  .facts {
    display: grid;
    grid-template-columns: auto auto;
    gap: 4px 12px;
    font-size: 0.9rem;
  }

  .facts dt {
    color: var(--sea-blue);
    font-weight: 700;
    text-align: right;
  }

  .facts dd {
    text-align: left;
  }

  .watched-form {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* "/ 224" stays in one piece */
  .watched-form span {
    white-space: nowrap;
  }

  /*
   * On a narrow card, each label sits above its value instead of beside it, so the Watched field,
   * the total and Save fit on one line
   */
  @container (max-width: 15rem) {
    .facts {
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 2px;
    }

    .facts dt,
    .facts dd {
      text-align: center;
    }

    .facts dd + dt {
      margin-top: 8px;
    }
  }

  .back-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-top: auto;
  }

  .download-link {
    color: var(--sea-blue);
    font-size: 0.85rem;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .download-link:hover,
  .download-link:focus-visible {
    color: var(--navy);
  }

  /* Without motion, the card simply switches sides */
  @media (prefers-reduced-motion: reduce) {
    .flipper {
      transition: none;
    }
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

  /* Sits over the bottom of the cover, above the title and progress (108px together) */
  .front-error {
    position: absolute;
    right: 14px;
    bottom: 116px;
    left: 14px;
    padding: 4px 8px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.95);
    box-shadow: 0 2px 8px rgb(15 61 110 / 0.25);
    text-align: center;
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

  /* Sea blue on white, outlined in You's sky blue: in the theme, but quieter than "behind" */
  .rewatch-badge {
    border-color: var(--you-blue);
    background: #ffffff;
    color: var(--sea-blue);
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

    /* Without motion, the glow and the wave appear at once, the wave stays still and the card never turns */
    .face,
    img,
    .wave {
      transition: none;
    }

    .card-slot:hover .wave,
    .card-slot:has(:focus-visible) .wave,
    .card-slot:hover .flipper,
    .card-slot:hover .front::after {
      animation: none;
    }
  }

  /* Every cover gets the same 3:4 frame, cropped to fit, whatever the image's own proportions */
  .cover-frame {
    position: relative;
    display: block;
    width: 100%;
    overflow: hidden;
    border-radius: var(--rounded-box, 1rem) var(--rounded-box, 1rem) 0 0;
  }

  img {
    display: block;
    width: 100%;
    aspect-ratio: 3 / 4;
    object-fit: cover;
    transition: filter 0.25s ease-out;
  }

  .card-slot:hover img,
  .card-slot:has(:focus-visible) img {
    filter: brightness(1.08);
  }

  /* A thin You-blue wave line along the bottom of the cover, shown and rolling on hover */
  .wave {
    position: absolute;
    inset: auto 0 4px;
    height: 8px;
    background-color: var(--you-blue-pale);
    mask: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='8' viewBox='0 0 32 8'><path d='M0 4 Q8 0 16 4 T32 4' fill='none' stroke='black' stroke-width='2'/></svg>")
      0 0 / 32px 8px repeat-x;
    opacity: 0;
    transition: opacity 0.25s ease-out;
    pointer-events: none;
  }

  .card-slot:hover .wave,
  .card-slot:has(:focus-visible) .wave {
    opacity: 0.9;
    animation: roll 1.6s linear infinite;
  }

  @keyframes roll {
    to {
      mask-position: 32px 0;
    }
  }

  /*
   * Mature covers, when the viewer's setting says so: blurred beyond recognition, slightly
   * enlarged so the blurred edges stay outside the frame, and labelled
   */
  .mature img {
    filter: blur(22px);
    scale: 1.1;
  }

  .card-slot:hover .mature img,
  .card-slot:has(:focus-visible) .mature img {
    filter: blur(22px) brightness(1.08);
  }

  .mature-label {
    position: absolute;
    top: 50%;
    left: 50%;
    padding: 4px 12px;
    border: 2px solid #ffffff;
    border-radius: 999px;
    background: rgb(15 61 110 / 0.85);
    color: #ffffff;
    font-size: 0.95rem;
    font-weight: 800;
    translate: -50% -50%;
  }
</style>
