<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { onMount, tick } from 'svelte';

  import CloseButton from '#lib/components/CloseButton.svelte';
  import ScoreInput from '#lib/components/ScoreInput.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { sequelFacts } from '#lib/planning.js';
  import { scoreChoices, type ScoreFormat } from '#lib/score.js';
  import type { Anime, Sequel } from '#lib/types/anime.js';
  import type { LinkedFailure, ListMove } from '#lib/types/api.js';
  import { animePageUrl, DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

  type Props = {
    /** The anime just completed, which has already left the Watching list */
    anime: Anime;
    /** The user's score format on the list's service */
    format: ScoreFormat;
    /** The service the list is on */
    domain?: Domain;
    /** Asks for a score first; not when the update that finished the anime already set one */
    askScore?: boolean;
    /**
     * The sequels to offer once the score is settled, looked up as the anime was finished. It never
     * rejects; with none, the prompt closes after the score as it always did
     */
    sequels?: Promise<Sequel[]>;
    /** The viewer's setting: blur covers of anime AniList marks as adult */
    blurMature?: boolean;
    /** Called once the prompt is closed, scored or not */
    onClose: () => void;
    /** Called when the score was saved, but not to the account linked to the list's service */
    onLinkedFailure?: (failure: LinkedFailure, saved: Anime) => void;
    /**
     * Called when a sequel was added to the Watching list, or to Planning when it's not out yet,
     * with the episode count it's at there
     */
    onAdded?: (sequel: Sequel, list: ListMove, progress: number) => void;
  };

  let {
    anime,
    format,
    domain = 'anilist',
    askScore = true,
    sequels,
    blurMature = true,
    onClose,
    onLinkedFailure,
    onAdded,
  }: Props = $props();
  const service = $derived(DOMAIN_NAMES[domain]);

  let dialog = $state<HTMLDialogElement>();
  // Starts from the score they may have given before, or "No score" / an empty field
  let score = $derived<number | null>(anime.userScore ?? (scoreChoices(format) ? 0 : null));
  let saving = $state(false);
  let errorMessage = $state<string | null>(null);

  // The score first, then the sequels to start or plan, when there are any
  let step = $state<'score' | 'next'>('score');
  let offered = $state<Sequel[]>([]);
  // Waiting for the sequels once the score is settled, which is usually over at once
  let moving = $state(false);
  let adds = $state<
    Record<number, { saving: boolean; added: boolean; linked?: LinkedFailure; message?: string }>
  >({});
  const anyAdded = $derived(Object.values(adds).some(({ added }) => added));
  // Said by a live region that's there from the start, as one added along with its words often isn't
  let announcement = $state('');
  const announced = (sequel: Sequel) => sequel.status === 'NOT_YET_RELEASED';
  const addedText = (sequel: Sequel) =>
    announced(sequel) ? 'Added to your plan list' : 'Added to your Watching list';

  // The lookup began as the anime was finished, so a slow one isn't waited for long
  const SEQUEL_WAIT_MS = 2000;

  function settled(): Promise<Sequel[]> {
    if (!sequels) return Promise.resolve([]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      sequels.catch(() => []),
      new Promise<Sequel[]>((resolve) => {
        timer = setTimeout(() => resolve([]), SEQUEL_WAIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  onMount(() => {
    if (!askScore) {
      void showNext(true);
      return;
    }
    dialog?.showModal();
    // Keep the rating field as the starting point while the close control stays keyboard-accessible.
    dialog?.querySelector<HTMLElement>('[name="score"]')?.focus();
  });

  /** Goes on to the sequels, or closes when there are none */
  async function showNext(opening = false) {
    moving = true;
    offered = await settled();
    moving = false;
    if (!offered.length) {
      if (opening) onClose();
      else dialog?.close();
      return;
    }
    step = 'next';
    if (opening) dialog?.showModal();
    await tick();
    dialog?.querySelector<HTMLElement>('.add')?.focus();
  }

  function addSequel(sequel: Sequel): SubmitFunction {
    return ({ formElement }) => {
      const added = adds[sequel.id]?.added ?? false;
      adds[sequel.id] = { saving: true, added, linked: adds[sequel.id]?.linked };
      return async ({ result }) => {
        if (result.type === 'success') {
          adds[sequel.id] = {
            saving: false,
            added: true,
            linked: result.data?.linked as LinkedFailure | undefined,
          };
          const list = announced(sequel) ? 'PLANNING' : 'CURRENT';
          announcement = `${addedText(sequel)}: ${sequel.title}`;
          if (!added) onAdded?.(sequel, list, Number(result.data?.progress ?? 0));
          // The button that had focus is gone; closing is what's left to do
          await tick();
          dialog?.querySelector<HTMLElement>('.done')?.focus();
        } else {
          adds[sequel.id] = {
            saving: false,
            added,
            linked: adds[sequel.id]?.linked,
            message:
              result.type === 'failure'
                ? String(result.data?.message ?? 'The update failed')
                : `${service} didn't answer, please try again`,
          };
          // Disabling the button while it saved took its focus, which goes back to try again
          await tick();
          if (!dialog?.contains(document.activeElement) || document.activeElement === dialog)
            formElement.querySelector('button')?.focus();
        }
      };
    };
  }
</script>

<!--
  Starts a sequel that's out, or plans one that isn't, which is quieter: there's nothing to watch yet
-->
{#snippet addForm(sequel: Sequel, label: string)}
  {@const busy = adds[sequel.id]?.saving ?? false}
  <form
    method="POST"
    action={announced(sequel) ? '?/planToWatch' : '?/startWatching'}
    use:enhance={addSequel(sequel)}
  >
    <input type="hidden" name="mediaId" value={sequel.id} />
    {#if sequel.malId !== null}<input type="hidden" name="malId" value={sequel.malId} />{/if}
    <button
      class={['tw:btn', 'add', !announced(sequel) && 'tw:btn-primary']}
      disabled={busy}
      aria-busy={busy}
      aria-label={`${label}: ${sequel.title}`}
    >
      {#if busy}<span class="tw:loading tw:loading-spinner tw:loading-xs" aria-hidden="true"
        ></span>{:else}{label}{/if}
    </button>
  </form>
{/snippet}

<!--
  Asked once an anime is completed: it then leaves the Watching list, and with it the card where
  the score could be set. Then, when the story goes on, it offers to start what comes next, which
  may not be on any list yet, or to plan it when it isn't out yet
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
    <CloseButton
      label={step === 'score' ? 'Close rating prompt' : 'Close sequel suggestions'}
      onclick={() => dialog?.close()}
    />
  </header>
  <div class="prompt-content">
    {#if step === 'score'}
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
            if (result.type === 'failure') {
              saving = false;
              errorMessage = (result.data?.message as string | undefined) ?? 'The update failed';
              return;
            }
            const linked = result.type === 'success' && (result.data?.linked as LinkedFailure);
            if (linked)
              onLinkedFailure?.(linked, {
                ...anime,
                userScore: Number(result.data?.score) || null,
              });
            await update({ reset: false, refreshAll: result.type !== 'success' });
            await showNext();
            saving = false;
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
          <button
            type="button"
            class="tw:btn tw:btn-ghost"
            disabled={saving || moving}
            aria-busy={moving && !saving}
            onclick={() => showNext()}
          >
            {#if moving && !saving}<span
                class="tw:loading tw:loading-spinner tw:loading-xs"
                aria-hidden="true"
              ></span>{/if}
            Maybe later
          </button>
          <button class="tw:btn tw:btn-primary" disabled={saving || moving || !score}>
            {#if saving}<span class="tw:loading tw:loading-spinner tw:loading-xs"></span>{/if}
            Save score
          </button>
        </div>
      </form>
    {:else}
      <h2 id="score-prompt-title" class="heading">Up next</h2>
      <p id="score-prompt-question" class="next-intro">
        Pick up where <span class="intro-title">{anime.title}</span> left off.
      </p>

      <ul class="sequels">
        {#each offered as sequel (sequel.id)}
          {@const add = adds[sequel.id]}
          <li class="sequel">
            <a
              class="sequel-link"
              href={animePageUrl(domain, sequel)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span class="sequel-cover">
                <SharedAnimePoster
                  anime={{
                    id: sequel.id,
                    title: sequel.title,
                    isAdult: sequel.isAdult,
                    coverUrl: sequel.coverUrl ?? undefined,
                  }}
                  compact
                  decorative
                  {blurMature}
                />
              </span>
              <span class="sequel-text">
                <span class="sequel-title">{sequel.title}</span>
                <span class="sequel-facts">{sequelFacts(sequel)}</span>
                <span class="tw:sr-only">, opens in a new tab</span>
              </span>
            </a>
            {#if add?.added}
              <p class="added"><span aria-hidden="true">✓</span> {addedText(sequel)}</p>
            {:else}
              {@render addForm(sequel, announced(sequel) ? 'Add to Planning' : 'Start watching')}
            {/if}
            {#if (add?.added && add.linked) || add?.message}
              <div class="sequel-notes">
                {#if add?.added && add.linked}
                  <p class="tw:text-error" role="alert">{add.linked.message}</p>
                  {#if add.linked.retry}{@render addForm(sequel, 'Try again')}{/if}
                {/if}
                {#if add?.message}
                  <p class="tw:text-error" role="alert">{add.message}</p>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      <p class="tw:sr-only" role="status">{announcement}</p>

      <div class="actions">
        <button type="button" class="tw:btn tw:btn-ghost done" onclick={() => dialog?.close()}>
          {anyAdded ? 'Done' : 'Not now'}
        </button>
      </div>
    {/if}
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

  .next-intro {
    margin-top: 6px;
    color: var(--text-accent);
    font-size: 0.9rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .intro-title {
    color: var(--text-heading);
    font-weight: 600;
  }

  /* One panel, a sequel to a row, its button under it so long titles keep the whole width */
  .sequels {
    margin-top: 14px;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    list-style: none;
    text-align: start;
  }

  .sequel {
    display: grid;
    gap: 10px;
    padding: 12px;
  }

  .sequel + .sequel {
    border-top: 1px solid var(--border-subtle);
  }

  .sequel-link {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    border-radius: var(--radius-control);
  }

  .sequel-cover {
    flex: none;
    width: 48px;
  }

  .sequel-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .sequel-title {
    color: var(--text-heading);
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .sequel-link:hover .sequel-title {
    text-decoration: underline;
  }

  .sequel-facts {
    color: var(--text-accent);
    font-size: 0.8rem;
  }

  .add {
    width: 100%;
    min-height: 44px;
  }

  /* As tall as the button it replaces, so the row doesn't jump */
  .added {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .sequel-notes {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }

  .done {
    min-height: 44px;
  }
</style>
