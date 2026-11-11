<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { page } from '$app/state';
  import { tick, untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';

  import {
    continuesUnseen,
    currentSeason,
    describeListed,
    describeWatching,
    forgetRecentSearches,
    foundState,
    hasSearch,
    hidesListed,
    highlightMatches,
    middleEllipsis,
    listedLookup,
    recentSearches,
    rememberHidesListed,
    rememberSearch,
    searchAnime,
    searchesOnPause,
    newResults,
    searchSeries,
    searchText,
    seasonAnime,
    seasonName,
    SEARCH_DELAY_MS,
    shortTitle,
    sideNotes,
    TITLE_LENGTH,
    titlesFor,
    type AnimeSeason,
    type FoundAnime,
    type WatchedAnime,
  } from '#lib/anime-search.js';
  import { forgetChange, recordListChange, updateChange } from '#lib/change-history.js';
  import CloseButton from '#lib/components/CloseButton.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { closeOnBackdrop } from '#lib/dialog.js';
  import { sequelFacts } from '#lib/planning.js';
  import {
    isBefore,
    type Before,
    type LinkedFailure,
    type ListMove,
    type OtherList,
  } from '#lib/types/api.js';
  import { animePageUrl, DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

  type Props = {
    open: boolean;
    /** The service the list is on, which the anime is added to */
    domain: Domain;
    /** The anime on the Watching list, by AniList id, which need no adding */
    watching: ReadonlyMap<number, WatchedAnime>;
    /**
     * The other lists each anime is on, by AniList id, which an AniList list's own read brings
     * along. A MyAnimeList list has none, so the dialog asks for them as it first opens
     */
    listed?: ReadonlyMap<number, OtherList>;
    /** Words to search for as the dialog opens, as typed in the list's own search */
    prefill?: string;
    /** The viewer's settings: whether adult anime are searched, and whether their covers blur */
    showMature: boolean;
    blurMature: boolean;
    onclose: () => void;
    /** Called when an anime was added or started, with the episode count it's at there */
    onAdded: (anime: FoundAnime, list: ListMove, progress: number) => void;
    /** Goes to an anime's card on the list, when the page shows cards */
    onShow?: (animeId: number) => void;
    /** Called when an add was undone, with the list the anime had gone to */
    onUndone?: (anime: FoundAnime, list: ListMove) => void;
  };

  let {
    open,
    domain,
    watching,
    listed,
    prefill = '',
    showMature,
    blurMature,
    onclose,
    onAdded,
    onShow,
    onUndone,
  }: Props = $props();
  const service = $derived(DOMAIN_NAMES[domain]);
  const id = $props.id();

  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  // Only opening and closing are followed here; what opening reads mustn't run it again
  $effect(() => {
    if (open) untrack(opened);
    else untrack(() => dialog?.open && dialog.close());
  });

  function opened() {
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // Browser storage is only read here, so the server renders the dialog the same for everyone
    hideListed = hidesListed();
    recent = recentSearches();
    if (hasSearch(prefill)) {
      search = prefill;
      void run(prefill);
    }
    input?.focus();
    input?.select();
    void loadListedMal();
  }

  /*
   * The season's most popular anime, shown while the search is empty, asked the first time it is:
   * one request to AniList a visit, from the browser like a search. Without them, as when AniList
   * is busy, the empty search only offers the recent searches
   */
  let season = $state<AnimeSeason | null>(null);
  let seasonal = $state<FoundAnime[]>([]);
  let askedSeason = false;
  $effect(() => {
    if (open && idle) untrack(loadSeason);
  });

  async function loadSeason() {
    // Asked again the next time the search is empty, though not before AniList takes requests again
    if (askedSeason || Date.now() < pausedUntil) return;
    askedSeason = true;
    const current = currentSeason();
    const outcome = await seasonAnime(current, { showMature });
    if ('results' in outcome) {
      season = current;
      seasonal = outcome.results;
      seasonPage = 1;
      seasonMore = outcome.more;
    } else {
      askedSeason = false;
      pauseFor(outcome);
    }
  }

  /*
   * A MyAnimeList user's other lists, by MyAnimeList id, asked once the first time the dialog
   * opens: one request to MyAnimeList per 1,000 anime on the list, once a visit. Without them, an
   * anime on one looks new until adding it finds out, which is still safe
   */
  let listedMal = $state<ReadonlyMap<number, OtherList> | null>(null);
  let askedListedMal = false;
  async function loadListedMal() {
    if (domain !== 'myanimelist' || askedListedMal) return;
    askedListedMal = true;
    try {
      const response = await fetch('/api/myanimelist/listed');
      const body = response.ok ? await response.json() : null;
      if (body?.listedIds && typeof body.listedIds === 'object') {
        listedMal = listedLookup(body.listedIds);
      } else askedListedMal = false;
    } catch {
      askedListedMal = false;
    }
  }
  const listedKeys = $derived(domain === 'anilist' ? (listed ?? null) : listedMal);
  const stateOf = (anime: FoundAnime) =>
    foundState(anime, { domain, watching, listed: listedKeys });

  let search = $state('');
  let results = $state<FoundAnime[]>([]);
  let body = $state<HTMLDivElement>();
  // An empty search field goes back to where the dialog starts: recent searches, nothing found yet
  const idle = $derived(!hasSearch(search));
  // The search the results are for, once one has finished
  let shown = $state<string | null>(null);
  let searching = $state(false);
  let message = $state<string | null>(null);
  let recent = $state<string[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  // AniList said to wait after too many searches, so none is sent before then
  let pausedUntil = 0;

  /** What to say while AniList said to wait, or null once it takes requests again */
  function stillPaused(): string | null {
    const wait = Math.ceil((pausedUntil - Date.now()) / 1000);
    return wait > 0
      ? `AniList has had a lot of searches from you. Try again in ${wait} seconds.`
      : null;
  }

  /** Waits as long as AniList said to, when it refused a request for too many */
  function pauseFor(outcome: { retryAfter?: number }) {
    if (outcome.retryAfter) pausedUntil = Date.now() + outcome.retryAfter * 1000;
  }

  /*
   * Looking for something new, the viewer can leave out what's on their lists already. An anime
   * added from these results stays, so what was done to it stays in sight
   */
  let hideListed = $state(false);
  const onLists = (anime: FoundAnime) => {
    const { kind } = stateOf(anime);
    return (kind === 'watching' || kind === 'listed') && !adds[anime.id]?.added;
  };
  // What's shown: the season's popular anime while the search is empty, what it found otherwise
  const source = $derived(idle ? seasonal : results);
  // The words found anime are highlighted with: none for the season's
  const words = $derived(idle ? '' : (shown ?? ''));
  const visible = $derived(hideListed ? source.filter((anime) => !onLists(anime)) : source);
  const hiddenCount = $derived(source.length - visible.length);
  // The parts of a series together, in the order to watch them, with their side stories
  const series = $derived(searchSeries(visible));
  const found = $derived(new Set(visible.map(({ id }) => id)));

  /** Searches once typing pauses, for a search long enough to narrow things down */
  function onInput() {
    clearTimeout(timer);
    if (searchesOnPause(search)) timer = setTimeout(() => void run(search), SEARCH_DELAY_MS);
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    clearTimeout(timer);
    if (hasSearch(search)) void run(search);
  }

  function searchAgain(text: string) {
    clearTimeout(timer);
    search = text;
    void run(text);
    input?.focus();
  }

  async function run(text: string) {
    if (shown !== null && searchText(text) === searchText(shown) && !message) return;
    const paused = stillPaused();
    if (paused) {
      message = paused;
      return;
    }
    controller?.abort();
    const current = (controller = new AbortController());
    searching = true;
    try {
      const outcome = await searchAnime(text, { showMature, signal: current.signal });
      if ('results' in outcome) {
        results = outcome.results;
        resultsPage = 1;
        resultsMore = outcome.more;
        moreMessage = null;
        shown = text;
        message = null;
        if (outcome.results.length) recent = rememberSearch(text);
        await tick();
        body?.scrollTo({ top: 0 });
      } else {
        message = outcome.message;
        pauseFor(outcome);
      }
    } catch {
      // Aborted by a newer search, which shows its own results
      return;
    } finally {
      if (controller === current) {
        searching = false;
        controller = null;
      }
    }
  }

  /*
   * More of what's shown, the search's or the season's, a page at a time: when scrolling brings the
   * end of the results near, or "Show more" is pressed. Each page is a request on the viewer's
   * AniList allowance, so there's one at a time, none while AniList said to wait, and no more than
   * MAX_PAGES of a list
   */
  let resultsPage = 0;
  let resultsMore = $state(false);
  let seasonPage = 0;
  let seasonMore = $state(false);
  let loadingMore = $state(false);
  // Why the last page wasn't shown, for the list it was for: the season's or the search's
  let moreMessage = $state<{ season: boolean; text: string } | null>(null);
  const more = $derived(idle ? seasonMore : resultsMore);
  const moreFailed = $derived(moreMessage?.season === idle ? moreMessage.text : null);
  let sentinel = $state<HTMLElement | null>(null);
  let moreButton = $state<HTMLButtonElement | null>(null);
  let observer: IntersectionObserver | undefined;

  $effect(() => {
    if (!sentinel || !body) return;
    const watched = sentinel;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(({ isIntersecting }) => isIntersecting)) void loadMore();
      },
      // A little before the end comes into view, so the next page is usually there in time
      { root: body, rootMargin: '0px 0px 240px 0px' }
    );
    observer.observe(watched);
    return () => observer?.disconnect();
  });

  async function loadMore() {
    if (loadingMore || searching || !more || moreFailed) return;
    const forSeason = idle;
    const paused = stillPaused();
    if (paused) {
      moreMessage = { season: forSeason, text: paused };
      return;
    }
    const text = shown;
    const asked = season;
    const page = (forSeason ? seasonPage : resultsPage) + 1;
    // Pressed rather than scrolled to, the button goes while loading: focus follows to what's new
    const pressed = document.activeElement === moreButton;
    loadingMore = true;
    const outcome = forSeason
      ? await seasonAnime(asked!, { showMature, page })
      : await searchAnime(text!, { showMature, page });
    loadingMore = false;
    // What's shown changed meanwhile, as when another search finished: this page isn't its
    if (forSeason !== idle || (!forSeason && shown !== text)) return;
    if (!('results' in outcome)) {
      moreMessage = { season: forSeason, text: outcome.message };
      pauseFor(outcome);
      return;
    }
    const added = newResults(forSeason ? seasonal : results, outcome.results);
    if (forSeason) {
      seasonal = [...seasonal, ...added];
      seasonPage = page;
      seasonMore = outcome.more;
    } else {
      results = [...results, ...added];
      resultsPage = page;
      resultsMore = outcome.more;
    }
    announcement = added.length ? `${added.length} more anime shown` : 'No more anime to show';
    await tick();
    if (pressed) {
      const first = added
        .map(({ id }) => dialog?.querySelector<HTMLElement>(`[data-anime="${id}"] .result-link`))
        .find((link) => link && link.getClientRects().length > 0);
      (first ?? moreButton)?.focus();
    }
  }

  /*
   * The observer only says when the end comes into view or leaves it. When what's shown changes
   * with the end already in view, as a new search or the filter leaving few anime, or a page that
   * added little, it's asked again, so the next page still follows
   */
  $effect(() => {
    void visible.length;
    void more;
    untrack(() => {
      if (!observer || !sentinel) return;
      observer.unobserve(sentinel);
      observer.observe(sentinel);
    });
  });

  function tryMoreAgain() {
    moreMessage = null;
    void loadMore();
  }

  function stop() {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
    searching = false;
  }

  /*
   * The arrow keys go from the search to the results and between them, one anime at a time, as a
   * list of suggestions would. Anime folded away with side stories are skipped until shown
   */
  function resultLinks(): HTMLElement[] {
    return [...(dialog?.querySelectorAll<HTMLElement>('.result-link') ?? [])].filter(
      (link) => link.getClientRects().length > 0
    );
  }

  function onSearchKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown') return;
    const [first] = resultLinks();
    if (!first) return;
    event.preventDefault();
    first.focus();
  }

  function onResultsKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.target === moreButton && event.key === 'ArrowUp') {
      event.preventDefault();
      resultLinks().at(-1)?.focus();
      return;
    }
    const row = (event.target as Element).closest?.('[data-anime]');
    const link = row?.querySelector<HTMLElement>('.result-link');
    if (!link) return;
    const links = resultLinks();
    const index = links.indexOf(link);
    if (index === -1) return;
    event.preventDefault();
    // Past the last anime, "Show more" is next, while there's more to show
    if (event.key === 'ArrowDown') (links[index + 1] ?? moreButton)?.focus();
    else (links[index - 1] ?? input)?.focus();
  }

  type Add = {
    saving: boolean;
    /** The list it went to, or already was on */
    added?: ListMove;
    already?: boolean;
    /** Moved from another of the lists, rather than added */
    moved?: boolean;
    /** Where it was before, which undoing puts it back to; unknown when it was there already */
    before?: Before;
    /** Where it was on the linked account, when the add changed it there too */
    linkedBefore?: Before;
    /** Being undone, which its Undo button shows */
    undoing?: boolean;
    /** The add in the history of recent changes, which undoing it here takes off there */
    changeId?: string;
    linked?: LinkedFailure;
    message?: string;
  };
  let adds = $state<Record<number, Add>>({});
  // Said by a live region that's there from the start, as one added along with its words often isn't
  let announcement = $state('');

  const announced = (anime: FoundAnime) => anime.status === 'NOT_YET_RELEASED';

  /*
   * Each title takes one line, cut in its middle to the width it has: the width of each title is
   * watched, as the dialog or its buttons change it, and so is how wide a letter of the title's
   * font is, measured once. Until they're known, and should a title still overflow, CSS ends it in
   * an ellipsis
   */
  let titleWidths = $state<Record<number, number>>({});
  // The last width measured, which a title not measured yet most likely has too, as rows match
  let lastWidth = $state(0);
  let letterWidth = $state(0);
  const titleSizes =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          for (const { target, contentRect } of entries) {
            // A side story folded away has no width until it's shown
            if (!contentRect.width) continue;
            titleWidths[Number((target as HTMLElement).dataset.fit)] = contentRect.width;
            lastWidth = contentRect.width;
          }
        });

  const fitTitle: Attachment<HTMLElement> = (element) => {
    if (!letterWidth) letterWidth = averageLetter(getComputedStyle(element));
    titleSizes?.observe(element);
    return () => titleSizes?.unobserve(element);
  };

  /*
   * The width of an average letter of a title, from a typical one, in its font as its parts give
   * it: some browsers don't put the computed `font` shorthand together
   */
  function averageLetter({ fontStyle, fontWeight, fontSize, fontFamily }: CSSStyleDeclaration) {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return 0;
    context.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
    const sample = 'Sousou no Frieren 2nd Season Shingeki no Kyojin';
    return context.measureText(sample).width / sample.length;
  }

  /** How many letters of a title fit its line, a little short of it, as letters vary in width */
  function fitLength(id: number): number {
    const width = titleWidths[id] ?? lastWidth;
    if (!width || !letterWidth) return TITLE_LENGTH;
    return Math.max(12, Math.floor(width / letterWidth) - 2);
  }

  /**
   * The one thing to do with a found anime, if any: start a planned one, resume a paused or dropped
   * one, go to the card of one being watched, plan one not out yet, or start or plan a new one. A
   * completed one, or one just started, has nothing left to do here
   */
  function actionFor(
    anime: FoundAnime,
    entry: Add | undefined,
    where: ReturnType<typeof stateOf>
  ): 'start' | 'resume' | 'show' | 'plan' | 'add' | null {
    const out = !announced(anime);
    if (entry?.added === 'CURRENT') return null;
    if (entry?.added === 'PLANNING' || (where.kind === 'listed' && where.list === 'PLANNING'))
      return out ? 'start' : null;
    if (where.kind === 'listed') return where.list !== 'COMPLETED' && out ? 'resume' : null;
    if (where.kind === 'watching') return onShow ? 'show' : null;
    if (where.kind === 'new') return out ? 'add' : 'plan';
    return null;
  }
  const listName = (list: ListMove) => (list === 'CURRENT' ? 'Watching list' : 'plan list');
  const addedText = ({ added, already, moved }: Add) =>
    `${already ? 'Already on' : moved ? 'Moved to' : 'Added to'} your ${listName(added!)}`;

  /**
   * Adds or moves an anime, `from` the list it's moved from when the page knows it; an add learns
   * where it was from the answer. A retry after the linked account missed the save keeps both
   */
  function add(anime: FoundAnime, list: ListMove, moved = false, from?: Before): SubmitFunction {
    return ({ formElement }) => {
      const previous = adds[anime.id];
      adds[anime.id] = { ...previous, saving: true, message: undefined };
      return async ({ result }) => {
        if (result.type === 'success') {
          const data = result.data ?? {};
          const linked = data.linked as LinkedFailure | undefined;
          const linkedBefore = isBefore(data.linkedBefore) ? data.linkedBefore : undefined;
          if (data.linkedOnly) {
            // Only the linked account was tried again: the add itself stands as it was
            adds[anime.id] = {
              ...previous,
              saving: false,
              linked,
              linkedBefore: linkedBefore ?? previous?.linkedBefore,
            };
            if (linkedBefore && previous?.changeId)
              updateChange(previous.changeId, { linkedBefore });
            if (!linked) announcement = `Saved on both lists: ${anime.title}`;
          } else {
            const already = data.already === true;
            const before = already ? undefined : isBefore(data.before) ? data.before : from;
            const changeId =
              already || previous?.added === list
                ? previous?.changeId
                : (recordListChange(domain, page.data, {
                    kind: 'move',
                    anime: {
                      mediaId: anime.id,
                      ...(anime.malId !== null && { malId: anime.malId }),
                      title: anime.title,
                      coverUrl: anime.coverUrl,
                      isAdult: anime.isAdult,
                    },
                    before: !before || before === 'NONE' ? null : { status: before },
                    after: { status: list, progress: Number(data.progress ?? 0) },
                    ...(linkedBefore && { linkedBefore }),
                  }) ?? undefined);
            adds[anime.id] = {
              saving: false,
              added: list,
              already,
              moved: moved || (previous?.moved ?? false),
              before,
              linkedBefore,
              linked,
              changeId,
            };
            announcement = `${addedText(adds[anime.id])}: ${anime.title}`;
            if (!already && previous?.added !== list)
              onAdded(anime, list, Number(data.progress ?? 0));
          }
          // The button may be gone; the anime's link keeps the viewer's place in the results
          await tick();
          if (!dialog?.contains(document.activeElement) || document.activeElement === dialog)
            dialog?.querySelector<HTMLElement>(`[data-anime="${anime.id}"] .result-link`)?.focus();
        } else {
          adds[anime.id] = {
            ...previous,
            saving: false,
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

  /**
   * Undoes an add: the anime goes back to where it was, which its row shows again, along with what
   * the linked account kept, if anything
   */
  function undo(anime: FoundAnime): SubmitFunction {
    return ({ formElement }) => {
      const previous = adds[anime.id];
      adds[anime.id] = { ...previous, saving: true, undoing: true, message: undefined };
      return async ({ result }) => {
        if (result.type === 'success') {
          const linked = result.data?.linked as LinkedFailure | undefined;
          if (linked) adds[anime.id] = { saving: false, message: linked.message };
          else delete adds[anime.id];
          if (previous.changeId) forgetChange(previous.changeId);
          announcement = `Undone: ${anime.title}`;
          onUndone?.(anime, previous.added!);
          await tick();
          if (!dialog?.contains(document.activeElement) || document.activeElement === dialog)
            dialog?.querySelector<HTMLElement>(`[data-anime="${anime.id}"] .result-link`)?.focus();
        } else {
          adds[anime.id] = {
            ...previous,
            saving: false,
            undoing: false,
            message:
              result.type === 'failure'
                ? String(result.data?.message ?? "The change couldn't be undone")
                : `${service} didn't answer, please try again`,
          };
          await tick();
          if (!dialog?.contains(document.activeElement) || document.activeElement === dialog)
            formElement.querySelector('button')?.focus();
        }
      };
    };
  }
</script>

<!--
  Undoes an add, sending the list it went to, where it was, and where it was on the linked account
  when the add changed that too
-->
{#snippet undoForm(anime: FoundAnime, entry: Add)}
  <form method="POST" action="?/undoAdd" use:enhance={undo(anime)}>
    <input type="hidden" name="mediaId" value={anime.id} />
    {#if anime.malId !== null}<input type="hidden" name="malId" value={anime.malId} />{/if}
    <input type="hidden" name="list" value={entry.added} />
    <input type="hidden" name="before" value={entry.before} />
    {#if entry.linkedBefore}<input
        type="hidden"
        name="linkedBefore"
        value={entry.linkedBefore}
      />{/if}
    <button
      class="tw:btn tw:btn-sm tw:btn-ghost action"
      disabled={entry.saving}
      aria-busy={entry.undoing}
      aria-label={`Undo: ${anime.title}`}
    >
      {#if entry.undoing}<span
          class="tw:loading tw:loading-spinner tw:loading-xs"
          aria-hidden="true"
        ></span>{:else}Undo{/if}
    </button>
  </form>
{/snippet}

<!--
  Adds an anime by its AniList id, and its MyAnimeList id, which a MyAnimeList list needs, once the
  server has checked where it is on the list and on the linked account: `from` the plan, paused or
  dropped list the page saw it on, for a move, which stays put if it has moved on since. A retry
  after the linked account missed the add only tries that account again. Planning has a bookmark;
  beside "Start" on a phone, it's only the bookmark
-->
{#snippet addForm(
  anime: FoundAnime,
  list: ListMove,
  label: string,
  name: string,
  how: 'add' | 'move' | 'retry',
  look: 'plain' | 'compact' = 'plain',
  from?: Before
)}
  {@const saving = adds[anime.id]?.saving ?? false}
  <!-- Waiting on an undo, it can't be pressed, but it isn't what's busy -->
  {@const busy = saving && !adds[anime.id]?.undoing}
  <form method="POST" action="?/addAnime" use:enhance={add(anime, list, how === 'move', from)}>
    <input type="hidden" name="mediaId" value={anime.id} />
    {#if anime.malId !== null}<input type="hidden" name="malId" value={anime.malId} />{/if}
    <input type="hidden" name="list" value={list} />
    {#if from}<input type="hidden" name="from" value={from} />{/if}
    {#if how === 'retry'}<input type="hidden" name="retry" value="linked" />{/if}
    <button
      class={['tw:btn tw:btn-sm', 'action', look === 'compact' && 'compact-action']}
      disabled={saving}
      aria-busy={busy}
      aria-label={`${name}: ${anime.title}`}
    >
      {#if busy}<span class="tw:loading tw:loading-spinner tw:loading-xs" aria-hidden="true"
        ></span>{:else}
        {#if list === 'PLANNING' && how !== 'retry'}{@render bookmark()}{/if}
        <span class={look === 'compact' ? 'compact-label' : undefined}>{label}</span>
      {/if}
    </button>
  </form>
{/snippet}

<!--
  A title, cut in its middle when it's huge, the whole of it then a tooltip and what screen readers
  read; `marked` highlights the words of the search in it
-->
{#snippet clipped(text: string, length: number, marked = false)}
  {@const short = middleEllipsis(text, length)}
  {#if short === text}{@render highlighted(text, marked)}{:else}<span
      aria-hidden="true"
      title={text}>{@render highlighted(short, marked)}</span
    ><span class="tw:sr-only">{text}</span>{/if}
{/snippet}

{#snippet highlighted(text: string, marked: boolean)}
  {#if marked}{#each highlightMatches(text, words) as piece, index (index)}{#if piece.match}<mark
          >{piece.text}</mark
        >{:else}{piece.text}{/if}{/each}{:else}{text}{/if}
{/snippet}

{#snippet bookmark()}
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linejoin="round"
    aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4z" /></svg
  >
{/snippet}

<dialog
  class="add-anime"
  use:closeOnBackdrop
  bind:this={dialog}
  aria-labelledby={`${id}-title`}
  aria-describedby={`${id}-description`}
  onclose={() => {
    stop();
    onclose();
  }}
>
  <header>
    <div class="heading">
      <h2 id={`${id}-title`}>Add anime</h2>
      <p id={`${id}-description`}>
        Find a show on AniList and add it to your {service} list.
      </p>
    </div>
    <CloseButton label="Close anime search" onclick={() => dialog?.close()} />
  </header>

  <form class="search" role="search" onsubmit={onSubmit}>
    <label class="tw:sr-only" for={`${id}-search`}>Anime title</label>
    <input
      id={`${id}-search`}
      bind:this={input}
      bind:value={search}
      oninput={onInput}
      onkeydown={onSearchKeydown}
      type="search"
      placeholder="Title, in English or Japanese"
      autocomplete="off"
      spellcheck="false"
      enterkeyhint="search"
    />
    <button class="tw:btn search-button" disabled={searching} aria-busy={searching}>
      {#if searching}<span class="tw:loading tw:loading-spinner tw:loading-xs" aria-hidden="true"
        ></span>{/if}
      Search
    </button>
  </form>

  <div class="toolbar">
    <p class="state" role="status">
      {#if searching}
        Searching AniList…
      {:else if message}
        <span class="tw:text-error">{message}</span>
      {:else if idle}
        Searches go straight to AniList.{#if hiddenCount}
          {hiddenCount} popular this season on your lists hidden.{/if}
      {:else if shown !== null && !results.length}
        No anime found for “{searchText(shown)}”. Try another title or spelling.
      {:else if shown !== null}
        {results.length === 1 ? 'One match' : `${results.length} closest matches`} for “{searchText(
          shown
        )}”{#if hiddenCount}, {hiddenCount} on your lists hidden{/if}
      {:else}
        Searches go straight to AniList.
      {/if}
    </p>
    {#if source.length}
      <label class="hide-listed">
        <input
          type="checkbox"
          class="tw:checkbox tw:checkbox-sm"
          bind:checked={hideListed}
          onchange={() => rememberHidesListed(hideListed)}
        />
        Hide shows on my lists
      </label>
    {/if}
  </div>

  <!-- The arrow keys only add to what the links and buttons inside already do -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="body" bind:this={body} onkeydown={onResultsKeydown}>
    {#if idle && !searching && recent.length}
      <section class="recent" aria-labelledby={`${id}-recent`}>
        <div class="recent-heading">
          <h3 id={`${id}-recent`}>Recent searches</h3>
          <button
            type="button"
            class="tw:btn tw:btn-ghost tw:btn-sm clear"
            onclick={() => {
              forgetRecentSearches();
              recent = [];
              input?.focus();
            }}>Clear</button
          >
        </div>
        <ul>
          {#each recent as text (text)}
            <li>
              <button
                type="button"
                class="tw:btn tw:btn-sm recent-search"
                onclick={() => searchAgain(text)}>{text}</button
              >
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if idle && season && visible.length}
      <h3 class="season-heading" id={`${id}-season`}>Popular in {seasonName(season)}</h3>
    {/if}
    {#if visible.length}
      <ul
        class="results"
        aria-label={idle ? undefined : 'Search results'}
        aria-labelledby={idle ? `${id}-season` : undefined}
      >
        {#each series as { parts, sides, sidesFirst } (parts[0].id)}
          {@const partNotes = sideNotes(parts, found, false)}
          {@const seriesTitle = titlesFor(parts[0], words).title}
          {#if parts.length === 1 && !sides.length}
            <li class="result" data-anime={parts[0].id}>
              {@render result(parts[0], { sideOf: partNotes[0] })}
            </li>
          {:else}
            <li class="series">
              <p class="series-label" aria-hidden="true">
                {parts.length > 1 ? `Series · ${parts.length} parts, in airing order` : 'Series'}
              </p>
              <ol
                class="parts"
                aria-label={parts.length > 1
                  ? `${seriesTitle} series, ${parts.length} parts in airing order`
                  : `${seriesTitle} series`}
              >
                {#each parts as anime, index (anime.id)}
                  <li class="result" data-anime={anime.id}>
                    {@render result(anime, {
                      part: parts.length > 1 ? index + 1 : undefined,
                      series: index ? seriesTitle : undefined,
                      sideOf: partNotes[index],
                    })}
                  </li>
                {/each}
              </ol>
              {#if sides.length}
                {@const notes = sideNotes(sides, found, true)}
                <!-- Folded away unless a side story is what the search found best -->
                <details class="sides" open={sidesFirst}>
                  <summary>
                    <svg
                      class="chevron"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg
                    >
                    {sides.length === 1 ? '1 side story' : `${sides.length} side stories`}
                  </summary>
                  <ul class="parts" aria-label={`Side stories of ${seriesTitle}`}>
                    {#each sides as anime, index (anime.id)}
                      <li class="result" data-anime={anime.id}>
                        {@render result(anime, { series: seriesTitle, sideOf: notes[index] })}
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
            </li>
          {/if}
        {/each}
      </ul>
    {:else if hiddenCount && !more}
      <p class="all-hidden">
        {idle
          ? 'Every popular anime this season is on your lists already.'
          : 'Every anime found is on your lists already.'}
        <button
          type="button"
          class="tw:btn tw:btn-sm"
          onclick={() => {
            hideListed = false;
            rememberHidesListed(false);
          }}>Show them</button
        >
      </p>
    {/if}
    {#if more}
      <!-- Where scrolling to the end shows more; the button shows more without scrolling -->
      <div class="more" bind:this={sentinel}>
        {#if loadingMore}
          <span class="tw:loading tw:loading-spinner tw:loading-sm" aria-hidden="true"></span>
          Loading more…
        {:else}
          {#if moreFailed}<p class="tw:text-error">{moreFailed}</p>{/if}
          <button
            type="button"
            class="tw:btn tw:btn-sm show-more"
            bind:this={moreButton}
            onclick={moreFailed ? tryMoreAgain : () => void loadMore()}
            >{moreFailed ? 'Try again' : 'Show more'}</button
          >
        {/if}
      </div>
    {/if}
  </div>

  <p class="tw:sr-only" role="status">{announcement}</p>
</dialog>

<!--
  One anime found, on one row: its cover, titles and facts link to its page, with what it continues
  when that wasn't found too, whose side story it is, and where it is on the viewer's lists. The one
  thing to do with it sits at the end of the row. A part of a series shows its place in it, which its
  list also tells screen readers, and its title without the series' own
-->
{#snippet result(
  anime: FoundAnime,
  { part, series, sideOf = null }: { part?: number; series?: string; sideOf?: string | null }
)}
  {@const entry = adds[anime.id]}
  {@const where = stateOf(anime)}
  {@const titles = titlesFor(anime, words)}
  {@const title = series ? shortTitle(titles.title, series) : titles.title}
  {@const continues = continuesUnseen(anime, found)}
  {@const action = actionFor(anime, entry, where)}
  {@const undoable = !!entry?.added && entry.before !== undefined}
  {@const other = title === titles.title ? titles.other : null}
  {@const status = entry?.added
    ? addedText(entry)
    : where.kind === 'watching'
      ? describeWatching(where.anime)
      : where.kind === 'listed'
        ? describeListed(where.list, domain)
        : null}
  {@const done = !!entry?.added || (where.kind === 'listed' && where.list === 'COMPLETED')}
  {@const notes = [
    continues && `Continues ${continues}`,
    sideOf && `Side story of ${sideOf}`,
    where.kind === 'unavailable' && "Not on MyAnimeList yet, so it can't be added there",
  ]
    .filter(Boolean)
    .join(' · ')}
  <div class="row">
    <a
      class="result-link"
      href={animePageUrl(domain, anime)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {#if part}<span class="part-number" aria-hidden="true">{part}</span>{/if}
      <span class="result-cover">
        <SharedAnimePoster
          anime={{
            id: anime.id,
            title: anime.title,
            isAdult: anime.isAdult,
            coverUrl: anime.coverUrl ?? undefined,
          }}
          compact
          decorative
          {blurMature}
        />
      </span>
      <!--
        Four lines, each one line tall whatever it holds, so every result is as tall as the next:
        the title, cut in its middle to fit; the title in the other language; what it is; and where
        it is on the viewer's lists, with what it continues. What doesn't fit ends in an ellipsis,
        whole in a tooltip and for screen readers
      -->
      <span class="result-text">
        <span class="line result-title" data-fit={anime.id} {@attach fitTitle}
          >{@render clipped(title, fitLength(anime.id), true)}</span
        >
        {#if title !== titles.title}<span class="tw:sr-only">, {titles.title}</span>{/if}
        <span class="line result-other" title={other ?? undefined}>{other ?? ''}</span>
        <span class="line result-facts">{sequelFacts(anime)}</span>
        <span
          class="line result-state"
          title={[status, notes].filter(Boolean).join(' · ') || undefined}
          >{#if status}<span class="result-status"
              >{#if done}<span aria-hidden="true">✓&nbsp;</span>{/if}{status}</span
            >{#if notes}&nbsp;·
            {/if}{/if}{notes}</span
        >
        <span class="tw:sr-only">, opens in a new tab</span>
      </span>
    </a>
    <!-- There even when empty, as a phone keeps a row for it under each anime -->
    <div class="row-actions">
      {#if action || undoable}
        {#if action === 'start'}
          {@render addForm(
            anime,
            'CURRENT',
            'Start',
            'Start watching',
            'move',
            'plain',
            'PLANNING'
          )}
        {:else if action === 'resume' && where.kind === 'listed'}
          {@render addForm(
            anime,
            'CURRENT',
            'Resume',
            'Resume watching',
            'move',
            'plain',
            where.list as Before
          )}
        {:else if action === 'show'}
          <button
            type="button"
            class="tw:btn tw:btn-sm action"
            aria-label={`Show on my list: ${anime.title}`}
            onclick={() => onShow?.(anime.id)}>Show</button
          >
        {:else if action === 'plan'}
          {@render addForm(anime, 'PLANNING', 'Plan', 'Add to Planning', 'add')}
        {:else if action === 'add'}
          {@render addForm(anime, 'CURRENT', 'Start', 'Start watching', 'add')}
          {@render addForm(anime, 'PLANNING', 'Plan', 'Add to Planning', 'add', 'compact')}
        {/if}
        {#if undoable}{@render undoForm(anime, entry!)}{/if}
      {/if}
    </div>
  </div>
  {#if (entry?.added && entry.linked) || entry?.message}
    <div class="notes">
      {#if entry?.added && entry.linked}
        <p class="tw:text-error" role="alert">{entry.linked.message}</p>
        <!-- Moved from a list, it says which, as the linked account is likely on it too -->
        {#if entry.linked.retry}{@render addForm(
            anime,
            entry.added,
            'Try again',
            'Try again',
            'retry',
            'plain',
            entry.moved ? entry.before : undefined
          )}{/if}
      {/if}
      {#if entry?.message}<p class="tw:text-error" role="alert">{entry.message}</p>{/if}
    </div>
  {/if}
{/snippet}

<style>
  /* Near the top, growing downwards, so it doesn't jump about as results come and go */
  .add-anime {
    --top: max(16px, 8dvh);
    margin: var(--top) auto auto;
    width: min(calc(100vw - 32px), 34rem);
    max-height: min(calc(100dvh - var(--top) - 16px), 760px);
    /* Only the results scroll: clipped, the dialog itself can't be scrolled, even by focus or find */
    overflow: clip;
    padding: var(--dialog-padding);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    color: var(--color-base-content);
    box-shadow: var(--shadow-dialog);
  }

  .add-anime[open] {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .add-anime::backdrop {
    background: var(--backdrop);
  }

  /* The heading, close control, search and its state stay in place while the results scroll */
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex: none;
  }

  .heading {
    min-width: 0;
  }

  h2 {
    color: var(--text-heading);
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1.25;
  }

  .heading p {
    margin-top: 4px;
    color: var(--text-accent);
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .search {
    display: flex;
    gap: 8px;
    flex: none;
  }

  .search input {
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text-heading);
    font-size: 1rem;
  }

  .search input::placeholder {
    color: var(--text-accent);
  }

  .search input:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }

  .search-button {
    min-height: 44px;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
    flex: none;
  }

  .state {
    flex: 1 1 14rem;
    color: var(--text-accent);
    font-size: 0.85rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .hide-listed {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: var(--text-heading);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .body {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 2px;
  }

  /* Below the recent searches when there are some, with the same small heading */
  .recent + .season-heading {
    margin-top: 16px;
  }

  .season-heading {
    margin-bottom: 6px;
  }

  .recent-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  h3 {
    color: var(--text-heading);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .recent ul {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
    padding: 0;
    list-style: none;
  }

  .recent-search {
    max-width: 100%;
    font-weight: 400;
    overflow-wrap: anywhere;
  }

  .more {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px 12px;
    padding: 12px 0 4px;
    color: var(--text-accent);
    font-size: 0.85rem;
    text-align: center;
  }

  .all-hidden {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 12px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    color: var(--text-accent);
    font-size: 0.85rem;
  }

  .results {
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    list-style: none;
  }

  /* Its one column narrows to the dialog, as the one-line titles in it would otherwise widen it */
  .result {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 10px 12px;
  }

  .results > li + li {
    border-top: 1px solid var(--border-subtle);
  }

  /* A series is one block of the results, its parts set apart more lightly than separate anime */
  .series-label {
    padding: 10px 12px 0;
    color: var(--text-accent);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .parts {
    padding: 0;
    list-style: none;
  }

  .parts > li + li {
    border-top: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
  }

  /* The anime and the one thing to do with it, side by side while they fit */
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }

  .result-link {
    display: flex;
    flex: 1 1 15rem;
    align-items: center;
    gap: 12px;
    min-width: 0;
    border-radius: var(--radius-control);
  }

  .result-link:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }

  /* Its place in the series, beside the cover so the titles stay aligned */
  .part-number {
    flex: none;
    width: 1.25rem;
    color: var(--text-accent);
    font-size: 0.85rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  /* As tall as the four lines beside it, which sets every result's height */
  .result-cover {
    flex: none;
    width: 52px;
  }

  .result-text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
  }

  /* One line each, however much or little is on it */
  .line {
    display: block;
    height: 1.3em;
    overflow: hidden;
    line-height: 1.3;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .result-title {
    color: var(--text-heading);
    font-size: 0.95rem;
    font-weight: 600;
  }

  .result-link:hover .result-title {
    text-decoration: underline;
  }

  /* What matched the search, in the selection's pale blue */
  mark {
    border-radius: 2px;
    background: var(--you-blue-pale);
    color: inherit;
  }

  .result-other {
    color: var(--text-heading);
    font-size: 0.8rem;
  }

  .result-facts,
  .result-state {
    color: var(--text-accent);
    font-size: 0.8rem;
  }

  .result-status {
    color: var(--text-heading);
    font-weight: 600;
  }

  .row-actions {
    display: flex;
    flex: none;
    gap: 6px;
    margin-left: auto;
  }

  .action {
    min-width: 4.5rem;
    gap: 4px;
  }

  /* Touch screens and phones get buttons big enough to tap, under the anime when they don't fit */
  @media (pointer: coarse), (max-width: 480px) {
    .action,
    .clear,
    .recent-search,
    .show-more {
      min-height: 44px;
    }
  }

  /*
   * On a phone, the buttons take the row under the anime. Planning beside starting is a square
   * bookmark there, its name left to screen readers, as there's no room to say it
   */
  @media (max-width: 480px) {
    /* Kept, empty or not, so a result with nothing to do is as tall as the rest */
    .row-actions {
      flex: 1 1 100%;
      min-height: 44px;
    }

    .row-actions > form,
    .row-actions > .action {
      flex: 1;
    }

    .row-actions .action {
      width: 100%;
    }

    .row-actions > form:has(.compact-action) {
      flex: none;
    }

    .row-actions .compact-action {
      width: 44px;
      min-width: 0;
      padding: 0;
    }

    .compact-label {
      display: none;
    }
  }

  /* A series' side stories, under its main story, folded away behind a row as tall as a button */
  .sides {
    border-top: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
  }

  .sides summary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    color: var(--text-accent);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }

  .sides summary::-webkit-details-marker {
    display: none;
  }

  .sides summary:hover {
    color: var(--text-heading);
  }

  .sides summary:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: -3px;
  }

  .chevron {
    flex: none;
    transition: rotate 150ms ease;
  }

  .sides[open] .chevron {
    rotate: 90deg;
  }

  .sides .parts > li {
    border-top: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }

  /* A short screen, as a phone on its side, keeps room for results */
  @media (max-height: 520px) {
    .add-anime {
      --top: 16px;
    }

    .add-anime[open] {
      gap: 8px;
    }

    .heading p {
      display: none;
    }
  }

  .notes {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
</style>
