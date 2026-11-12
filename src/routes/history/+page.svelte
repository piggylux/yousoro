<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';

  import {
    describeChange,
    forgetChange,
    listChanges,
    revertForm,
    revertState,
    type ListChange,
  } from '#lib/change-history.js';
  import CloseButton from '#lib/components/CloseButton.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { recordOwnWatchingEntry } from '#lib/friend-watching.js';
  import { forgetRememberedLists } from '#lib/list-moves.js';
  import type { LinkedFailure } from '#lib/types/api.js';
  import { DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // Kept in the tab's storage, so they're only known in the browser
  let changes = $state<ListChange[] | null>(null);
  onMount(() => {
    changes = listChanges();
  });

  const signedIn = $derived(
    new Set([
      ...(data.user ? [`anilist:${data.user.id}`] : []),
      ...(data.malUser ? [`myanimelist:${data.malUser.id}`] : []),
    ])
  );
  // The signed-in accounts' alone, as the layout drops the others' as they sign out
  const shown = $derived(
    (changes ?? []).filter(({ account }) => signedIn.has(`${account.domain}:${account.id}`))
  );
  const bothSignedIn = $derived(signedIn.size > 1);

  // How each revert asked for here is going, by change id: saving, or why it failed
  let reverts = $state<Record<string, { saving: boolean; message?: string }>>({});
  /*
   * Reverted on the list's service, but not on the linked account: it missed it, or it keeps an
   * anime a move only copied there. These are off the history already, but stay in view with what
   * happened until they're dismissed, or tried again and done
   */
  let unsettled = $state<Record<string, { linked?: LinkedFailure; stays?: string }>>({});
  // Those left to revert, which decide which change of an anime is reverted next
  const pending = $derived(shown.filter((change) => !unsettled[change.id]));
  // Said by a live region that's there from the start, as one added along with its words often isn't
  let announcement = $state('');

  const otherDomain = (domain: Domain): Domain =>
    domain === 'anilist' ? 'myanimelist' : 'anilist';

  /** When it was saved, on the 24-hour clock: the time today, or the day and time before */
  function savedAt(at: number) {
    const date = new Date(at);
    const time = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    if (date.toDateString() === new Date().toDateString()) return time;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
  }

  /*
   * A move the linked account only copied isn't taken off there, as it may have been there before:
   * that's said once it's reverted, when that account is signed in
   */
  function staysOnLinked(change: ListChange): string | undefined {
    const other = otherDomain(change.account.domain);
    const linkedIn = other === 'anilist' ? data.user : data.malUser;
    if (change.kind !== 'move' || change.before || change.linkedBefore || !linkedIn) return;
    return `It stays on your ${DOMAIN_NAMES[other]} list.`;
  }

  /**
   * Once a change is reverted, the lists the tab remembers are read again, so the list, plan and
   * season pages show it as it now is: a finished anime reverted is back among the cards. The friends
   * pages are told what the viewer is watching now, as a save tells them
   */
  function refreshAfter(change: ListChange, entry: { progress?: unknown; status?: unknown }) {
    const { account, anime, before } = change;
    forgetRememberedLists(account.domain, account.name);
    if (account.domain !== 'anilist' || !data.user || anime.mediaId === undefined) return;
    const status = String(entry.status ?? before?.status ?? 'NONE');
    recordOwnWatchingEntry(
      data.user,
      {
        id: anime.mediaId,
        title: anime.title,
        isAdult: anime.isAdult,
        thumbnailUrl: anime.coverUrl ?? '',
        currentEpisode: Number(entry.progress ?? before?.progress ?? 0),
        rewatching: status === 'REPEATING',
      },
      status
    );
  }

  const rowOf = (change: ListChange) => document.querySelector(`[data-change="${change.id}"]`);

  // Focuses the first of `selectors`, in their order, found within `scope`
  function focusFirst(scope: ParentNode, selectors: string[]) {
    for (const selector of selectors) {
      const element = scope.querySelector<HTMLElement>(selector);
      if (element) return element.focus({ preventScroll: true });
    }
  }

  /**
   * Takes a row off the page, once its change is reverted or dismissed. When focus was in it, or
   * was lost as its button was disabled while saving, it goes to the row that takes its place, or
   * the one before when it was the last, or to the empty history
   */
  async function removeRow(change: ListChange) {
    const focused = document.activeElement;
    const moveFocus =
      !focused || focused === document.body || Boolean(rowOf(change)?.contains(focused));
    const index = shown.findIndex(({ id }) => id === change.id);
    changes = (changes ?? []).filter(({ id }) => id !== change.id);
    delete unsettled[change.id];
    delete reverts[change.id];
    if (!moveFocus) return;
    await tick();
    const rows = document.querySelectorAll('.changes > .change');
    const next = rows[index] ?? rows[index - 1];
    focusFirst(next ?? document, ['.revert', '.title', '.empty']);
  }

  function revert(change: ListChange): SubmitFunction {
    return () => {
      reverts[change.id] = { saving: true };
      return async ({ result }) => {
        const service = DOMAIN_NAMES[change.account.domain];
        if (result.type !== 'success') {
          reverts[change.id] = {
            saving: false,
            message:
              result.type === 'failure'
                ? String(result.data?.message ?? "The change couldn't be reverted")
                : `${service} didn't answer, please try again`,
          };
          // A sign-in that expired signs out of that service, which the header shows
          if (result.type === 'failure' && result.status === 401) await invalidateAll();
          await tick();
          rowOf(change)?.querySelector<HTMLElement>('.revert')?.focus({ preventScroll: true });
          return;
        }
        // Reverted on the list's service, so there's nothing left to revert in the history
        forgetChange(change.id);
        refreshAfter(change, result.data ?? {});
        const linked = result.data?.linked as LinkedFailure | undefined;
        // Said once, as it's reverted; trying again only reaches the linked account
        const stays = unsettled[change.id] ? undefined : staysOnLinked(change);
        if (!linked && !stays) {
          announcement = `Reverted: ${change.anime.title}`;
          await removeRow(change);
          return;
        }
        // What happened on the linked account stays in view, in the row
        delete reverts[change.id];
        unsettled[change.id] = { linked, stays };
        announcement = `Reverted on ${service}: ${change.anime.title}`;
        await tick();
        const row = rowOf(change);
        if (row) focusFirst(row, ['.revert', '.reverted']);
      };
    };
  }
</script>

<!--
  Reverts a change by the action that undoes it on the account's list; trying again after the linked
  account missed it sends the same form, which then only reaches the linked account
-->
{#snippet revertButton(change: ListChange, label: string, name: string)}
  {@const { action, fields } = revertForm(change)}
  {@const busy = reverts[change.id]?.saving ?? false}
  <form method="POST" {action} use:enhance={revert(change)}>
    {#each Object.entries(fields) as [field, value] (field)}
      <input type="hidden" name={field} {value} />
    {/each}
    <button class="tw:btn revert" disabled={busy} aria-busy={busy} aria-label={name}>
      {#if busy}<span class="tw:loading tw:loading-spinner tw:loading-xs" aria-hidden="true"
        ></span>{:else}{label}{/if}
    </button>
  </form>
{/snippet}

<section class="history">
  <h1 class="heading">Recent changes</h1>
  {#if !data.user && !data.malUser}
    <p class="intro">Sign in to see the changes you make to your lists, and to revert them.</p>
  {:else}
    <p class="intro">
      Changes you save in this tab, newest first. They're kept while this tab is open, and cleared
      when you sign out. A change leaves the list once it's reverted.
    </p>
    {#if changes === null}
      <p class="loading" aria-hidden="true">
        <span class="tw:loading tw:loading-spinner tw:loading-sm"></span>
      </p>
    {:else if !shown.length}
      <p class="empty" tabindex="-1">
        Nothing to revert in this tab. Episodes, scores and list moves you save will show up here,
        so you can put them back.
      </p>
    {:else}
      <ul class="changes">
        {#each shown as change (change.id)}
          {@const left = unsettled[change.id]}
          {@const message = reverts[change.id]?.message}
          <li class="change" class:unsettled={left} data-change={change.id}>
            <span class="poster">
              <SharedAnimePoster
                anime={{
                  id: change.anime.mediaId ?? change.anime.malId ?? 0,
                  title: change.anime.title,
                  isAdult: change.anime.isAdult,
                  coverUrl: change.anime.coverUrl,
                }}
                compact
                decorative
                blurMature={data.preferences.blurMature || !data.preferences.showMature}
              />
            </span>
            <div class="details">
              <h2 class="title" tabindex="-1">{change.anime.title}</h2>
              {#each describeChange(change) as line, index (index)}
                <p class="what">{line}</p>
              {/each}
              <p class="meta">
                <time datetime={new Date(change.at).toISOString()}>{savedAt(change.at)}</time>
                {#if bothSignedIn}<span>· {DOMAIN_NAMES[change.account.domain]}</span>{/if}
              </p>
              <div class="outcome">
                {#if left}
                  <p class="reverted" tabindex="-1">
                    <span aria-hidden="true">✓</span>
                    Reverted on {DOMAIN_NAMES[change.account.domain]}{#if left.stays}. {left.stays}{/if}
                  </p>
                  {#if left.linked}
                    <p class="failed" role="alert">{left.linked.message}</p>
                    <!-- Only a save or a removal reverted again reaches the linked account alone -->
                    {#if left.linked.retry && change.kind !== 'move'}
                      {@render revertButton(
                        change,
                        'Try again',
                        `Try again to revert ${change.anime.title} on the linked account`
                      )}
                    {/if}
                  {/if}
                {:else if revertState(change, pending) === 'later'}
                  <p class="later">Revert the later change to this anime first.</p>
                {:else}
                  {@render revertButton(change, 'Revert', `Revert: ${change.anime.title}`)}
                {/if}
                {#if message}
                  <p class="failed" role="alert">{message}</p>
                {/if}
              </div>
            </div>
            {#if left}
              <span class="dismiss">
                <CloseButton
                  label={`Dismiss: ${change.anime.title}`}
                  onclick={() => removeRow(change)}
                />
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  <p class="tw:sr-only" role="status">{announcement}</p>
</section>

<style>
  .history {
    width: 100%;
    max-width: 40rem;
    margin: 16px auto 0;
  }

  .heading {
    margin-bottom: 12px;
    color: var(--text-heading);
    font-size: 1.75rem;
    font-weight: 600;
  }

  .intro,
  .empty {
    margin-bottom: 20px;
    color: var(--text-accent);
    line-height: 1.5;
  }

  .empty {
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .loading {
    display: flex;
    justify-content: center;
    padding: 24px 0;
    color: var(--text-accent);
  }

  .changes {
    display: grid;
    gap: 12px;
    list-style: none;
  }

  .change {
    position: relative;
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  /* Room beside the title for the dismiss control */
  .change.unsettled {
    padding-right: 60px;
  }

  .dismiss {
    position: absolute;
    top: 8px;
    right: 8px;
  }

  .poster {
    display: block;
  }

  .details {
    display: grid;
    align-content: start;
    gap: 4px;
    min-width: 0;
  }

  .title {
    color: var(--text-heading);
    font-size: 1rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .what {
    color: var(--text-heading);
    font-size: 0.9rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    color: var(--text-accent);
    font-size: 0.8rem;
  }

  .outcome {
    display: grid;
    justify-items: start;
    gap: 8px;
    margin-top: 8px;
  }

  .revert {
    min-height: 44px;
    min-width: 44px;
  }

  .reverted,
  .later {
    color: var(--text-accent);
    font-size: 0.85rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .reverted {
    color: var(--text-heading);
  }

  /* Focused from script alone, as what takes the place of a row or button that's gone */
  .title:focus,
  .reverted:focus,
  .empty:focus {
    outline: none;
  }

  .failed {
    color: var(--color-error);
    font-size: 0.85rem;
    line-height: 1.4;
  }

  @media (max-width: 480px) {
    .change {
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
    }

    .change.unsettled {
      padding-right: 56px;
    }

    .dismiss {
      top: 4px;
      right: 4px;
    }

    .revert {
      width: 100%;
    }

    .outcome {
      justify-items: stretch;
    }
  }
</style>
