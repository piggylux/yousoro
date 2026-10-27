<script lang="ts">
  import { onMount, untrack } from 'svelte';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import { runFriendsLookup } from '#lib/friend-watching.js';
  import type { FriendWatchingResult, FriendsLookupState } from '#lib/types/friend-watching.js';

  let {
    viewerId,
    mediaIds,
    onresult,
    onstatus,
    contextKey = '',
    refreshOnReturn = true,
  }: {
    viewerId: number;
    mediaIds: number[];
    onresult: (result: FriendWatchingResult | null) => void;
    onstatus?: (status: FriendsLookupState['status']) => void;
    contextKey?: string;
    refreshOnReturn?: boolean;
  } = $props();
  const key = $derived([...new Set(mediaIds)].sort((a, b) => a - b).join(','));
  let refresh = $state(0);
  let lookup = $state<FriendsLookupState>({ status: 'loading' });
  let now = $state(Date.now());
  let loadedAt = $state(0);
  const autoRetryAt = $derived(
    lookup.status === 'unavailable'
      ? lookup.retryAt
      : lookup.status === 'ready' && lookup.result.retryAfter
        ? loadedAt + lookup.result.retryAfter * 1000
        : 0
  );
  let previous: {
    viewerId: number;
    contextKey: string;
    refresh: number;
    ids: Set<number>;
    result: FriendWatchingResult;
  } | null = null;

  $effect(() => {
    const id = viewerId;
    const ids = key ? key.split(',').map(Number) : [];
    const context = contextKey;
    const revision = refresh;
    // Finishing a show removes its card. Saving progress must not reload friends,
    // even when the remaining matches have passed their cache expiry time.
    if (
      previous &&
      previous.viewerId === id &&
      previous.contextKey === context &&
      previous.refresh === revision &&
      ids.every((mediaId) => previous!.ids.has(mediaId))
    ) {
      lookup = { status: 'ready', result: previous.result };
      untrack(() => {
        onresult(previous!.result);
        onstatus?.('ready');
      });
      return;
    }
    let active = true;
    untrack(() => {
      void runFriendsLookup(id, ids, (state) => {
        if (!active) return;
        lookup = state;
        onresult(
          state.status === 'ready'
            ? state.result
            : state.status === 'loading' &&
                previous?.viewerId === id &&
                previous.contextKey === context
              ? previous.result
              : null
        );
        onstatus?.(state.status);
        if (state.status === 'ready') {
          previous = {
            viewerId: id,
            contextKey: context,
            refresh: revision,
            ids: new Set(ids),
            result: state.result,
          };
          loadedAt = Date.now();
        }
      });
    });
    return () => {
      active = false;
    };
  });

  onMount(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    const returned = () => {
      if (refreshOnReturn && !document.hidden && loadedAt && Date.now() - loadedAt >= 5 * 60 * 1000)
        refresh++;
    };
    document.addEventListener('visibilitychange', returned);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', returned);
    };
  });
</script>

<div class="friends-status" aria-live="polite">
  {#if lookup.status === 'loading'}
    <span>Loading friends watching…</span>
  {:else if lookup.status === 'unavailable'}
    <span>{lookup.message}</span>
    <button
      type="button"
      class="tw:btn tw:btn-xs"
      disabled={now < lookup.retryAt}
      onclick={() => refresh++}
    >
      {now < lookup.retryAt ? `Retry in ${Math.ceil((lookup.retryAt - now) / 1000)}s` : 'Retry'}
    </button>
  {:else if lookup.result.partial}
    <span>Showing some matches. More friends may be watching.</span>
  {/if}
</div>
<AutoReadRetry
  retryKey={`friends:${viewerId}:${contextKey}:${key}`}
  retryAt={autoRetryAt}
  recovered={lookup.status === 'ready' && !lookup.result.partial}
  onretry={() => refresh++}
/>

<style>
  .friends-status {
    text-align: center;
    font-size: 0.85rem;
    margin: 8px 0;
  }
  button {
    margin-left: 8px;
  }
</style>
