<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';

  import CloseButton from '#lib/components/CloseButton.svelte';
  import ScoreInput from '#lib/components/ScoreInput.svelte';
  import { scoreChoices, type ScoreFormat } from '#lib/score.js';
  import type { Anime } from '#lib/types/anime.js';

  type Props = {
    /** The anime just completed, which has already left the Watching list */
    anime: Anime;
    /** The user's score format on the list's service */
    format: ScoreFormat;
    /** The service the list is on */
    service?: string;
    /** The viewer's setting: blur covers of anime AniList marks as adult */
    blurMature?: boolean;
    /** Called once the prompt is closed, scored or not */
    onClose: () => void;
  };

  let { anime, format, service = 'AniList', blurMature = true, onClose }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  // Starts from the score they may have given before, or "No score" / an empty field
  let score = $derived<number | null>(anime.userScore ?? (scoreChoices(format) ? 0 : null));
  let saving = $state(false);
  let errorMessage = $state<string | null>(null);

  onMount(() => {
    dialog?.showModal();
    // Keep the rating field as the starting point while the close control stays keyboard-accessible.
    dialog?.querySelector<HTMLElement>('[name="score"]')?.focus();
  });
</script>

<!--
  Asked once an anime is completed: it then leaves the Watching list, and with it the card where
  the score could be set
-->
<dialog
  class="score-prompt"
  bind:this={dialog}
  aria-labelledby="score-prompt-title"
  aria-describedby="score-prompt-question"
  onclose={onClose}
>
  <header class="prompt-header">
    <!-- "Yousoro!", You Watanabe's sailor's call, which the app is named after -->
    <p class="greeting" aria-hidden="true">⚓ ヨーソロー!</p>
    <CloseButton label="Close rating prompt" onclick={() => dialog?.close()} />
  </header>
  <div class="prompt-content">
    <span class="cover-frame" class:mature={anime.isAdult && blurMature}>
      <img src={anime.thumbnailUrl} alt="" />
    </span>

    <h2 id="score-prompt-title" class="heading">
      You finished <span class="title">{anime.title}</span>
    </h2>
    <p id="score-prompt-question" class="question">What did you think of it?</p>

    <form
      method="POST"
      action="?/updateEntry"
      use:enhance={() => {
        saving = true;
        errorMessage = null;
        return async ({ result, update }) => {
          saving = false;
          if (result.type === 'failure') {
            errorMessage = (result.data?.message as string | undefined) ?? 'The update failed';
            return;
          }
          await update({ reset: false, refreshAll: result.type !== 'success' });
          dialog?.close();
        };
      }}
    >
      <input type="hidden" name="mediaId" value={anime.id} />
      {#if anime.malId !== null}<input type="hidden" name="malId" value={anime.malId} />{/if}
      <input type="hidden" name="scoreFormat" value={format} />
      <div class="field">
        <ScoreInput {format} bind:value={score} label="Your score" size="large" />
      </div>
      <p class="note">Your score is saved to your {service} list.</p>

      {#if errorMessage}
        <p class="tw:text-error tw:text-sm" role="alert">{errorMessage}</p>
      {/if}

      <div class="actions">
        <button type="button" class="tw:btn tw:btn-ghost" onclick={() => dialog?.close()}>
          Maybe later
        </button>
        <button class="tw:btn tw:btn-primary" disabled={saving || !score}>
          {#if saving}<span class="tw:loading tw:loading-spinner tw:loading-xs"></span>{/if}
          Save score
        </button>
      </div>
    </form>
  </div>
</dialog>

<style>
  /* Centered on screen; the reset in app.css takes away the browser's own margin: auto */
  .score-prompt {
    margin: auto;
    width: min(22rem, calc(100vw - 32px));
    padding: var(--dialog-padding);
    max-height: calc(100dvh - 32px);
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-box, 1rem);
    background: var(--you-blue-pale);
    color: var(--text-heading);
    box-shadow: var(--shadow-dialog);
    text-align: center;
  }

  .score-prompt[open] {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .prompt-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    gap: 12px;
  }

  .prompt-content {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px;
  }

  .score-prompt::backdrop {
    background: var(--backdrop);
  }

  .cover-frame {
    display: block;
    width: 84px;
    margin: 0 auto 14px;
    overflow: hidden;
    border-radius: 10px;
    box-shadow: 0 6px 16px rgb(15 61 110 / 0.3);
  }

  .cover-frame img {
    display: block;
    width: 100%;
    aspect-ratio: 3 / 4;
    object-fit: cover;
  }

  /* An adult cover stays blurred here too, when the viewer's setting says so */
  .mature img {
    filter: blur(12px);
    scale: 1.1;
  }

  .greeting {
    color: var(--text-accent);
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .heading {
    margin-top: 4px;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.35;
  }

  /* The title stands out on its own lines, long ones cut at three */
  .title {
    display: -webkit-box;
    margin-top: 2px;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    font-size: 1.2rem;
    font-weight: 600;
  }

  .question {
    margin-top: 14px;
    font-weight: 600;
  }

  .field {
    display: flex;
    justify-content: center;
    margin: 10px 0 6px;
  }

  .note {
    color: var(--text-accent);
    font-size: 0.8rem;
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 18px;
  }
</style>
