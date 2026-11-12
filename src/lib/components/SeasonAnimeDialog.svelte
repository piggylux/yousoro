<script lang="ts">
  import type { FoundState } from '#lib/anime-search.js';
  import AddToListActions from '#lib/components/AddToListActions.svelte';
  import AnimeTrailer from '#lib/components/AnimeTrailer.svelte';
  import CloseButton from '#lib/components/CloseButton.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { closeOnBackdrop } from '#lib/dialog.js';
  import type { ListAdds } from '#lib/list-adds.svelte.js';
  import { distinctEnglishTitle, sequelFacts } from '#lib/planning.js';
  import type { SeasonPick } from '#lib/season-picks.js';
  import { animePageUrl, DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

  /*
   * One anime of a season, in full: what it is, where it is on the owner's lists, why it's picked
   * for them, its trailer, what it's about, and the one thing to do with it. Closing it stops the
   * trailer, as the player goes with the rest of its content. The season's tiles stay the same
   * size whatever they hold, so all of this is here instead
   */
  type Props = {
    /** The anime shown; null while the dialog is closed */
    pick: SeasonPick | null;
    /** Where it is on the owner's lists, and that said as the viewer reads it */
    where: FoundState | null;
    status: string | null;
    /** Whether there's nothing left to do with it, as the ✓ beside its status says */
    done: boolean;
    domain: Domain;
    /**
     * Whether the viewer owns the list, and can add the anime to it. Where it is there comes from
     * the page's own read of the list, so adding it doesn't ask again
     */
    canEdit: boolean;
    adds: ListAdds;
    /** Who it's picked for, as "you" or a name, for the heading of its reasons */
    forWhom: string;
    blurMature: boolean;
    onclose: () => void;
  };

  let { pick, where, status, done, domain, canEdit, adds, forWhom, blurMature, onclose }: Props =
    $props();
  const heading = $props.id();
  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (pick && dialog && !dialog.open) dialog.showModal();
    else if (!pick && dialog?.open) dialog.close();
  });

  const anime = $derived(pick?.anime ?? null);
  const english = $derived(anime && distinctEnglishTitle(anime));
</script>

<dialog use:closeOnBackdrop bind:this={dialog} aria-labelledby={heading} {onclose}>
  {#if pick && anime && where}
    <header>
      <div class="heading-copy">
        <p class="eyebrow">{sequelFacts(anime)}</p>
        <h2 id={heading}>{anime.title}</h2>
        {#if english}<p class="other">{english}</p>{/if}
      </div>
      <CloseButton label="Close anime details" onclick={() => dialog?.close()} />
    </header>

    <div class="body">
      <div class="overview">
        <div class="cover">
          <SharedAnimePoster
            anime={{
              id: anime.id,
              title: anime.title,
              isAdult: anime.isAdult,
              coverUrl: anime.coverUrl,
            }}
            compact
            decorative
            {blurMature}
          />
        </div>
        <div class="overview-copy">
          {#if status}
            <p class="status">
              {#if done}<span aria-hidden="true">✓&nbsp;</span>{/if}{status}
            </p>
          {:else if where.kind === 'unavailable'}
            <p class="status">Not on MyAnimeList yet, so it can't be added there</p>
          {/if}
          <dl class="facts">
            {#if anime.studios.length}
              <div>
                <dt>{anime.studios.length === 1 ? 'Studio' : 'Studios'}</dt>
                <dd>{anime.studios.join(', ')}</dd>
              </div>
            {/if}
            {#if anime.genres.length}
              <div>
                <dt>Genres</dt>
                <dd>{anime.genres.join(', ')}</dd>
              </div>
            {/if}
            {#if anime.averageScore !== null}
              <div>
                <dt>AniList average</dt>
                <dd>{anime.averageScore}%</dd>
              </div>
            {/if}
          </dl>
          <a
            class="service-link"
            href={animePageUrl(domain, anime)}
            target="_blank"
            rel="noopener noreferrer"
            >See it on {DOMAIN_NAMES[domain]}<span aria-hidden="true">&nbsp;↗</span><span
              class="tw:sr-only">, opens in a new tab</span
            ></a
          >
        </div>
      </div>

      {#if canEdit}
        <div class="actions">
          <AddToListActions
            {adds}
            {anime}
            {where}
            known
            focusFallback={() => dialog?.querySelector<HTMLElement>('.service-link')}
          />
        </div>
      {/if}

      {#if pick.note || pick.reasons.length}
        <section aria-labelledby={`${heading}-why`}>
          <h3 id={`${heading}-why`}>Why it's picked for {forWhom}</h3>
          {#if pick.note}<p class="note">{pick.note}</p>{/if}
          {#if pick.reasons.length}
            <ul class="reasons">
              {#each pick.reasons as reason (reason)}<li>{reason}</li>{/each}
            </ul>
          {/if}
        </section>
      {/if}

      {#if anime.trailer}
        <section aria-labelledby={`${heading}-trailer`}>
          <h3 id={`${heading}-trailer`}>Trailer</h3>
          <!-- Another anime's details start with its trailer not playing -->
          {#key anime.id}
            <AnimeTrailer
              video={anime.trailer}
              title={anime.title}
              blurred={anime.isAdult && blurMature}
            />
          {/key}
        </section>
      {/if}

      {#if anime.synopsis}
        <section aria-labelledby={`${heading}-about`}>
          <h3 id={`${heading}-about`}>About</h3>
          <p class="synopsis">{anime.synopsis}</p>
        </section>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  dialog {
    margin: auto;
    width: min(calc(100vw - 32px), 36rem);
    max-height: min(85dvh, 760px);
    padding: var(--dialog-padding);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    color: var(--color-base-content);
    box-shadow: var(--shadow-dialog);
    /* Only the body scrolls, so the heading and its close button stay in sight */
    overflow: hidden;
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  dialog::backdrop {
    background: var(--backdrop);
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex: none;
  }

  .heading-copy {
    flex: 1;
    min-width: 0;
  }

  .eyebrow {
    margin-bottom: 3px;
    color: var(--text-accent);
    font-size: 0.75rem;
    font-weight: 600;
  }

  h2 {
    color: var(--text-heading);
    font-size: 1.15rem;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .other {
    margin-top: 2px;
    color: var(--text-accent);
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Room for the focus outline of what's at its edges */
    padding: 3px;
    margin: -3px;
  }

  .overview {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    align-items: start;
    gap: 16px;
  }

  .overview-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  .status {
    color: var(--text-heading);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .facts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.85rem;
  }

  .facts dt {
    color: var(--text-accent);
    font-size: 0.75rem;
  }

  .facts dd {
    color: var(--text-heading);
    overflow-wrap: anywhere;
  }

  .service-link {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    border-radius: var(--radius-control);
    color: var(--you-blue);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .service-link:hover {
    text-decoration: underline;
  }

  .service-link:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }

  /* As narrow as a phone's row, its buttons take the whole width (see AddToListActions) */
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    container-type: inline-size;
  }

  h3 {
    margin-bottom: 6px;
    color: var(--text-heading);
    font-size: 0.9rem;
    font-weight: 600;
  }

  .note {
    margin-bottom: 6px;
    color: var(--text-heading);
    font-size: 0.85rem;
    font-style: italic;
  }

  .reasons {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 1.1em;
    color: var(--text-heading);
    font-size: 0.85rem;
    line-height: 1.4;
    list-style: disc;
    overflow-wrap: anywhere;
  }

  .synopsis {
    color: var(--text-heading);
    font-size: 0.875rem;
    line-height: 1.55;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  @media (max-width: 480px) {
    .overview {
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 12px;
    }
  }
</style>
