<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { onDestroy, onMount, tick } from 'svelte';

  import {
    BIG_BACKLOG,
    getEpisodesToWatch,
    getWatchState,
    hasNewEpisode,
    mayHaveNewEpisode,
    type WatchState,
  } from '#lib/anime.js';
  import { clock } from '#lib/clock.js';
  import ScoreInput from '#lib/components/ScoreInput.svelte';
  import { formatAirDate, formatAirsIn } from '#lib/countdown.js';
  import { flippedCard } from '#lib/flipped-card.svelte.js';
  import { nyaaSearchUrl, nyaaSite } from '#lib/nyaa.js';
  import { countsBeforeSave } from '#lib/saved-counts.js';
  import {
    DEFAULT_SCORE_FORMAT,
    describeScore,
    formatMeanScore,
    formatScore,
    scoreChoices,
    type ScoreFormat,
  } from '#lib/score.js';
  import type { Anime } from '#lib/types/anime.js';
  import type { DownloadLanguage, DownloadVersion } from '#lib/types/preferences.js';

  type Props = {
    anime: Anime;
    animeLinkFn: (animeId: number) => string;
    /** Whether the signed-in user can update this anime's progress */
    canEdit?: boolean;
    /**
     * Called when an update catches the user up on this anime, or finishes it, with the anime as
     * AniList saved it; `scored` says the same update also set its score
     */
    onCaughtUp?: (
      kind: 'caught-up' | 'completed',
      anime: Anime,
      update: { scored: boolean }
    ) => void;
    /** The viewer's setting: blur covers of anime AniList marks as adult */
    blurMature?: boolean;
    /** The viewer's setting: which releases the nyaa.si search looks for */
    downloadLanguage?: DownloadLanguage;
    /** The viewer's setting: subbed, dubbed or dual-audio releases for that search */
    downloadVersion?: DownloadVersion;
    /** How the list owner scores anime on AniList, which `anime.userScore` is in */
    scoreFormat?: ScoreFormat;
    /** Where the card is in the list, counting from 0 */
    position?: number;
    /** Called once a save is done and the list reloaded, with where the card was before */
    onSaved?: (animeId: number, positionBefore: number) => void;
    /** Glows for a moment, so the eye finds the card in its new place after a save */
    highlighted?: boolean;
  };

  let {
    anime,
    animeLinkFn,
    canEdit = false,
    onCaughtUp,
    blurMature = true,
    downloadLanguage = 'any',
    downloadVersion = 'any',
    scoreFormat = DEFAULT_SCORE_FORMAT,
    position = 0,
    onSaved,
    highlighted = false,
  }: Props = $props();

  const coverBlurred = $derived(anime.isAdult && blurMature);

  // Countdowns use the viewer's clock and time zone, so they only appear once in the browser
  let mounted = $state(false);
  onMount(() => (mounted = true));
  // A card that leaves the page, as when it scrolls out of a long list, no longer counts as the one
  // turned over, or the page would wait forever for it to be turned back before reloading
  onDestroy(() => {
    if (flippedCard.id === uid) flippedCard.id = null;
  });

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
  // How many episodes have aired, on the card's back, unless that's all of them
  const airedNote = $derived(
    anime.numberAiredEpisodes && anime.numberAiredEpisodes !== totalEpisodes
      ? `${anime.numberAiredEpisodes.toLocaleString()} aired`
      : null
  );
  const episodesToWatch = $derived(getEpisodesToWatch(anime));
  const watchState = $derived(getWatchState(anime));
  // The next episode to watch, when it has already aired; only offered on the viewer's own list
  const nextToWatch = $derived(canEdit && episodesToWatch > 0 ? anime.currentEpisode + 1 : null);
  // Only a just-aired episode makes the badge pulse, so the pulse means something. It depends on the
  // viewer's clock, so like the countdowns it waits for the browser. Cards that can't have one
  // don't read the clock, so they aren't updated as it ticks
  const newEpisode = $derived(
    mounted && mayHaveNewEpisode(anime) && hasNewEpisode(anime, clock.now)
  );

  /*
   * Once the viewer's save lowers the count, as after +1, the number ticks into place, and
   * reaching zero splashes the caught-up badge. This card may be new, if the save moved it, so the
   * count before the save comes from outside it
   */
  let countTicks = $state(0);
  let justCaughtUp = $state(false);
  $effect(() => {
    const before = countsBeforeSave.get(anime.id);
    if (before === undefined || before === episodesToWatch) return;
    countsBeforeSave.delete(anime.id);
    if (episodesToWatch < before) countTicks += 1;
    justCaughtUp = episodesToWatch === 0;
  });

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

  // The score picked on the card's back, which resets to the saved score whenever that changes.
  // Star and smiley choices start on "No score"; a number field starts empty
  const savedScore = $derived(anime.userScore ?? (scoreChoices(scoreFormat) ? 0 : null));
  let scoreDraft = $derived<number | null>(savedScore);
  // 0 is no score, the same as an unscored anime
  const scoreChanged = $derived((scoreDraft ?? 0) !== (anime.userScore ?? 0));
  const entryChanged = $derived(watchedChanged || scoreChanged);
  // The fields sit in the facts list, outside their form, so they point to it by an id unique
  // to this card
  const uid = $props.id();
  const entryFormId = `entry-${uid}`;

  // Back to what's saved on AniList, dropping unsaved edits
  function revertDrafts() {
    watchedDraft = anime.currentEpisode;
    scoreDraft = savedScore;
  }
  let errorMessage = $state<string | null>(null);

  // The card flips over to show its details, instead of opening a popup
  let flipped = $state(false);
  let coverButton = $state<HTMLButtonElement>();
  let backFace = $state<HTMLElement>();

  /*
   * Focus follows the side that's showing, so keyboard users land on what they can see, except when
   * the card is turned back because another one was turned over
   */
  async function flip(showBack: boolean, { moveFocus = true } = {}) {
    flipped = showBack;
    if (showBack) flippedCard.id = uid;
    else if (flippedCard.id === uid) flippedCard.id = null;
    if (!showBack) {
      // Turning back over discards an unsaved edit and any error, so the next flip starts fresh
      revertDrafts();
      errorMessage = null;
    }
    await tick();
    if (!moveFocus) return;
    // Without scrolling: the card is already where the user is looking, even if partly off screen
    const options = { preventScroll: true };
    if (showBack) backFace?.querySelector<HTMLElement>('a, button, input')?.focus(options);
    else coverButton?.focus(options);
  }

  // Only one card shows its back at a time: this one turns back when another is turned over, a
  // moment later, so the two turns follow each other rather than happen at once
  const TURN_BACK_DELAY_MS = 100;
  $effect(() => {
    if (!flipped || flippedCard.id === uid) return;
    const timer = setTimeout(() => flip(false, { moveFocus: false }), TURN_BACK_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const submitEntry: SubmitFunction = ({ formData }) => {
    saving = true;
    errorMessage = null;
    const stateBefore = watchState;
    const progressBefore = anime.currentEpisode;
    const positionBefore = position;
    const scored = formData.has('score') && scoreChanged;

    return async ({ result, update }) => {
      saving = false;
      if (result.type === 'failure') {
        errorMessage = (result.data?.message as string | undefined) ?? 'The update failed';
        return;
      }
      if (result.type === 'success') {
        const saved = {
          ...anime,
          currentEpisode: Number(result.data?.progress),
          userScore: Number(result.data?.score) || null,
        };
        // A new episode count shows on the front; a score alone stays in view on the back
        if (flipped && saved.currentEpisode !== progressBefore) await flip(false);

        // Celebrate only the moment the user catches up or finishes, judged by what AniList saved
        const stateAfter = getWatchState(saved);
        const wasDone = stateBefore === 'caught-up' || stateBefore === 'completed';
        if (!wasDone && (stateAfter === 'caught-up' || stateAfter === 'completed')) {
          onCaughtUp?.(stateAfter, saved, { scored });
        }
        // The card shows the new count once the list reloads, maybe as a new card if it moves
        if (saved.currentEpisode !== progressBefore)
          countsBeforeSave.set(anime.id, episodesToWatch);
      }
      // Reloads the list, so the card shows what AniList saved
      await update({ reset: false });
      if (result.type === 'success') onSaved?.(anime.id, positionBefore);
    };
  };
</script>

<!-- Esc turns the card back over while focus is on its back; in a dropdown, it only closes the list -->
<svelte:window
  onkeydown={(event) => {
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      !(event.target instanceof HTMLSelectElement) &&
      flipped &&
      backFace?.contains(document.activeElement)
    )
      flip(false);
  }}
/>

<div class="card-slot tw:indicator tw:h-full" class:highlight={highlighted}>
  <!-- Every badge sits in the same place, centered on top of the card, so they're easy to scan -->
  {#if watchState === 'completed'}
    <span class="card-badge tw:indicator-item tw:indicator-center tw:badge tw:badge-success"
      >✓ Completed</span
    >
  {:else if watchState === 'caught-up'}
    <span
      class="card-badge tw:indicator-item tw:indicator-center tw:badge tw:badge-success"
      class:splash={justCaughtUp}
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
      class:new-episode={newEpisode}
      class:deep={episodesToWatch >= BIG_BACKLOG}
      aria-label={`${newEpisode ? 'New episode. ' : ''}${episodesToWatch} episode${episodesToWatch === 1 ? '' : 's'} to watch`}
    >
      {#if newEpisode}New ·{/if}
      {#key countTicks}
        <span class="count" class:ticked={countTicks > 0}>{episodesToWatch.toLocaleString()}</span>
      {/key}
      behind
    </span>
  {/if}
  <div class="anime-card" class:flipped>
    <!--
      A click anywhere on the card turns it over, except on its links, buttons and form fields, and
      around the actions at the bottom of the back, so a click that just misses one doesn't. It's
      handled here rather than on each side, so it works mid-turn too: the side being left is
      already inert. Keyboard users have the cover button, so the click needs no key equivalent.
    -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="flipper"
      onclick={(event) => {
        const target = event.target as Element;
        if (!target.closest('a, button, input, select, textarea, label, form, .back-actions')) {
          flip(!flipped);
        }
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
            <form method="POST" action="?/updateEntry" use:enhance={submitEntry}>
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
        <!--
          Always two lines tall, so the details sit at the same height on every card. Only the
          title's own text is the link; the space around a short title turns the card back over
        -->
        <p class="back-title">
          <a href={animeLinkFn(anime.id)} target="_blank" title={anime.title}>
            {anime.title}<span class="tw:sr-only">, on AniList, opens in a new tab</span>
          </a>
        </p>

        <!-- When a small card runs short of room, only the details scroll; the actions stay put -->
        <div class="facts-area">
          <dl class="facts">
            <dt>Watched</dt>
            <dd>
              {#if canEdit}
                <!-- Its form, with the one Save button for the count and the score, is below -->
                <span class="field-form">
                  <input
                    class="tw:input tw:input-xs tw:w-16"
                    type="number"
                    name="progress"
                    form={entryFormId}
                    min="0"
                    max={totalEpisodes ?? undefined}
                    bind:value={watchedDraft}
                    aria-label="Episodes watched"
                    required
                  />
                  <span>/ {totalEpisodes ?? '?'}</span>
                </span>
              {:else}
                {progressLabel}
              {/if}
              {#if airedNote}<span class="aired-note">({airedNote})</span>{/if}
            </dd>
            {#if canEdit}
              <dt>Score</dt>
              <dd>
                <!-- In the owner's AniList scoring system; "No score" or an empty field clears it -->
                <span class="field-form">
                  <ScoreInput
                    format={scoreFormat}
                    bind:value={scoreDraft}
                    label="Your score"
                    form={entryFormId}
                  />
                </span>
              </dd>
            {:else if anime.userScore}
              <dt>Score</dt>
              <dd>
                <span aria-hidden="true">{formatScore(anime.userScore, scoreFormat)}</span>
                <span class="tw:sr-only">{describeScore(anime.userScore, scoreFormat)}</span>
              </dd>
            {/if}
            {#if anime.meanScore}
              <!-- AniList's mean score: the average of everyone's scores there -->
              <dt>Average</dt>
              <dd>{formatMeanScore(anime.meanScore)}</dd>
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
        </div>

        <!--
          Pinned to the bottom, so the buttons and errors line up across cards too. Only there when
          it holds something, as clicks on it don't turn the card
        -->
        {#if canEdit || nextToWatch || (errorMessage && flipped)}
          <div class="back-actions">
            {#if canEdit}
              <!--
              Saves the watched count and the score together; Enter in either field saves too. Revert
              puts both back to what's saved on AniList
            -->
              <form
                id={entryFormId}
                class="entry-actions"
                method="POST"
                action="?/updateEntry"
                use:enhance={submitEntry}
              >
                <input type="hidden" name="mediaId" value={anime.id} />
                <input type="hidden" name="scoreFormat" value={scoreFormat} />
                <button
                  type="button"
                  class="tw:btn tw:btn-ghost tw:btn-xs"
                  disabled={saving || !entryChanged}
                  onclick={revertDrafts}
                >
                  Revert
                </button>
                <button class="tw:btn tw:btn-primary tw:btn-xs" disabled={saving || !entryChanged}>
                  Save
                </button>
              </form>
            {/if}
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
                <!-- Always two lines, one each, so the button is the same size for either site -->
                <span class="download-line"
                  ><span class="download-words">Find episode</span> {nextToWatch}</span
                >
                <span class="download-line download-site">on {nyaaSite(anime.isAdult)}</span>
                <span class="tw:sr-only">, opens in a new tab</span>
              </a>
            {/if}
            {#if errorMessage && flipped}
              <p class="tw:text-error tw:text-sm" role="alert">{errorMessage}</p>
            {/if}
          </div>
        {/if}
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
   * As a hint that the card turns over, hovering its front starts to turn it and lets it settle
   * back, as a light gleam sweeps across. The turn uses `rotate`, separate from the flip's
   * `transform`, so a click mid-hint still flips the card smoothly. It ends flat, so the text ends
   * sharp. The back doesn't move on hover, so its fields stay still while being used
   */
  .card-slot:hover .anime-card:not(.flipped) .flipper {
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
    background: var(--surface);
    color: var(--color-base-content);
    backface-visibility: hidden;
    transition: box-shadow 0.2s ease-out;
  }

  /*
   * Sea glow: on hover, or when a keyboard user is on the card, a sky-blue glow rings it, the cover
   * brightens and a wave rolls along its bottom edge. Nothing moves or scales, so it stays sharp
   */
  /* After a save moves the card, a sky-blue ring that fades out, so the eye finds it again */
  .highlight .face {
    animation: found 2s ease-out;
  }

  @keyframes found {
    0%,
    40% {
      box-shadow:
        0 0 0 4px var(--you-blue),
        0 0 28px 6px rgb(73 185 249 / 0.6);
    }
  }

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
    gap: 12px;
    --back-padding-y: 16px;
    --back-padding-x: 14px;
    padding: var(--back-padding-y) var(--back-padding-x);
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
    height: 2lh;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--text-heading);
    font-size: 1.05rem;
    font-weight: 800;
    line-height: 1.3;
  }

  .back-title a:hover,
  .back-title a:focus-visible {
    color: var(--text-accent);
    text-decoration: underline;
  }

  /* As wide as the card's back, not its widest field, which then fits inside it */
  .facts-area {
    align-self: stretch;
    display: flex;
    /* The details keep together at the top, whatever room is left below them */
    align-items: flex-start;
    justify-content: center;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    /* Room for the fields' focus rings, which the scrolling would otherwise clip */
    padding: 3px;
  }

  .facts {
    min-width: 0;
    max-width: 100%;
    display: grid;
    align-content: start;
    grid-template-columns: auto auto;
    gap: 4px 12px;
    font-size: 0.9rem;
  }

  .facts dt {
    color: var(--text-accent);
    font-weight: 700;
    text-align: right;
  }

  .facts dd {
    text-align: left;
  }

  .field-form {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    /* Never wider than the card, so a long score choice is cut short instead */
    max-width: 100%;
    min-width: 0;
  }

  /* "/ 224" stays in one piece */
  .field-form span {
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
      gap: 0;
      line-height: 1.25;
    }

    .facts dt,
    .facts dd {
      max-width: 100%;
      text-align: center;
    }

    /* Smaller labels, so more of the details fit before they have to scroll */
    .facts dt {
      font-size: 0.75rem;
    }

    .facts dd + dt {
      margin-top: 6px;
    }
  }

  /* Revert and Save, at the bottom with the other actions */
  .entry-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
  }

  .back-actions {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    /* Reaches over the back's padding, so a click that just misses an action, below or beside it,
       doesn't turn the card */
    margin: auto calc(-1 * var(--back-padding-x)) calc(-1 * var(--back-padding-y));
    padding: 0 var(--back-padding-x) var(--back-padding-y);
    /* The back centers its content; this spans it, so the link is as wide as the card */
    align-self: stretch;
  }

  .aired-note {
    margin-left: 4px;
    color: var(--text-accent);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  /* A pill as wide as the card allows, so it's an easy target rather than a line of small text */
  .download-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    /* Little side padding, so both lines fit even on the smallest cards */
    padding: 0.35rem 0.25rem;
    border: 2px solid var(--you-blue);
    border-radius: 999px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 0.85rem;
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
    transition:
      background-color 0.15s ease-out,
      color 0.15s ease-out;
  }

  /*
   * Each line stays on one line, cut short on the narrowest cards rather than wrapping. On the
   * first, only the words are cut, never the episode number
   */
  .download-line {
    display: flex;
    gap: 0.25em;
    max-width: 100%;
    white-space: nowrap;
  }

  .download-words,
  .download-site {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .download-site {
    font-size: 0.75rem;
    font-weight: 600;
  }

  .download-link:hover,
  .download-link:focus-visible {
    background: var(--sea-blue);
    color: #ffffff;
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
    background: var(--surface);
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
    box-shadow: inset 0 0 0 1px var(--border-subtle);
  }

  .episode-bar .watched {
    background: var(--text-accent);
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
    /* Its words are separate flex items, so a word's width apart rather than daisyUI's wide gap */
    gap: 0.3em;
    background: linear-gradient(135deg, #1872b8, var(--sea-blue));
    color: #ffffff;
    box-shadow:
      0 4px 12px rgb(20 95 156 / 0.45),
      0 0 0 3px rgb(73 185 249 / 0.35);
  }

  /*
   * A big backlog sinks into deeper water: navy, with faint diagonal stripes like light through
   * waves. Still blue, so it reads as "a lot to catch up on", not as an alarm
   */
  .behind-badge.deep {
    background:
      repeating-linear-gradient(135deg, rgb(255 255 255 / 0.1) 0 4px, transparent 4px 9px),
      linear-gradient(135deg, var(--sea-blue), var(--navy));
    box-shadow:
      0 4px 12px rgb(15 61 110 / 0.5),
      0 0 0 3px rgb(20 95 156 / 0.35);
  }

  /* The count drops in from above and settles with a small bounce */
  .count {
    display: inline-block;
  }

  .count.ticked {
    animation: count-tick 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes count-tick {
    0% {
      translate: 0 -0.6em;
      opacity: 0;
    }
    100% {
      translate: 0 0;
      opacity: 1;
    }
  }

  /* Sea blue on white, outlined in You's sky blue: in the theme, but quieter than "behind" */
  .rewatch-badge {
    border-color: var(--you-blue);
    background: var(--surface);
    color: var(--text-accent);
  }

  /*
   * A sky-blue ring pulses out from the badge and fades, like a gentle heartbeat, while an episode
   * is new. Only the ring grows, so the badge and its text stay sharp. All new badges pulse together,
   * so the grid breathes calmly instead of flickering
   */
  .behind-badge.new-episode::after {
    content: '';
    position: absolute;
    /* Over the badge's white border too */
    inset: -2px;
    border-radius: inherit;
    animation: pulse 2s ease-out 0.5s infinite;
    pointer-events: none;
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgb(73 185 249 / 0.7);
    }
    70%,
    100% {
      box-shadow: 0 0 0 10px rgb(73 185 249 / 0);
    }
  }

  /* Catching up splashes: a sky-blue ring bursts out of the caught-up badge, once */
  .splash::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    animation: splash 0.8s ease-out 0.15s both;
    pointer-events: none;
  }

  @keyframes splash {
    0% {
      box-shadow:
        0 0 0 0 rgb(73 185 249 / 0.9),
        0 0 0 0 rgb(73 185 249 / 0.6);
    }
    100% {
      box-shadow:
        0 0 0 18px rgb(73 185 249 / 0),
        0 0 0 30px rgb(73 185 249 / 0);
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

    .behind-badge.new-episode::after,
    .splash::after {
      display: none;
    }

    .count.ticked {
      animation: none;
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
