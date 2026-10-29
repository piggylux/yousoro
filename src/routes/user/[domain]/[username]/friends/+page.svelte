<script lang="ts">
  import { onMount } from 'svelte';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import FriendsWatchingLoader from '#lib/components/FriendsWatchingLoader.svelte';
  import SharedAnimeDialog from '#lib/components/SharedAnimeDialog.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import TasteTwins from '#lib/components/TasteTwins.svelte';
  import { FriendsUnavailable, getOwnSharedAnime } from '#lib/friend-watching.js';
  import type {
    FriendWatchingResult,
    FriendsLookupState,
    SharedAnime,
  } from '#lib/types/friend-watching.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let anime = $state<SharedAnime[] | null>(null);
  let matches = $state<FriendWatchingResult | null>(null);
  let matchesStatus = $state<FriendsLookupState['status']>('loading');
  let message = $state('');
  let retryAt = $state(0);
  let now = $state(Date.now());
  let refresh = $state(0);
  let loadedAt = 0;
  $effect(() => {
    const own = data.isOwnPage;
    const id = data.user.id;
    const showMature = data.preferences.showMature;
    void refresh;
    let active = true;
    anime = null;
    matches = null;
    matchesStatus = 'loading';
    message = '';
    retryAt = 0;
    if (own && data.friends.length) {
      getOwnSharedAnime(id, showMature)
        .then((list) => {
          if (active) {
            loadedAt = Date.now();
            anime = list
              .filter((entry) => showMature || !entry.isAdult)
              .sort((a, b) => a.title.localeCompare(b.title));
          }
        })
        .catch((error) => {
          if (!active) return;
          matchesStatus = 'unavailable';
          message =
            error instanceof FriendsUnavailable ? error.message : 'Shared anime is unavailable.';
          retryAt = error instanceof FriendsUnavailable ? error.retryAt : 0;
        });
    }
    return () => {
      active = false;
    };
  });
  onMount(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    const returned = () => {
      if (!document.hidden && loadedAt && Date.now() - loadedAt >= 5 * 60 * 1000) refresh++;
    };
    document.addEventListener('visibilitychange', returned);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', returned);
    };
  });
  let search = $state('');
  let togetherOnly = $state(false);
  const sharedByFriend = $derived.by(() => {
    const grouped = new Map<number, (SharedAnime & { progress: number; rewatching: boolean })[]>();
    for (const entry of anime ?? []) {
      for (const friend of matches?.matches[entry.id] ?? []) {
        const shared = grouped.get(friend.id) ?? [];
        shared.push({ ...entry, progress: friend.progress, rewatching: friend.rewatching });
        grouped.set(friend.id, shared);
      }
    }
    return grouped;
  });
  const sharedWith = (id: number) => sharedByFriend.get(id) ?? [];
  let selectedFriend = $state<number | null>(null);
  const sharedSelection = $derived.by(() => {
    if (!data.isOwnPage || selectedFriend === null || !matches) return null;
    const friend = data.friends.find((friend) => friend.id === selectedFriend);
    return friend ? { friend, anime: sharedWith(friend.id) } : null;
  });
  const togetherCount = $derived(
    data.friends.filter((friend) => sharedWith(friend.id).length).length
  );
  const visibleFriends = $derived(
    data.friends
      .filter(
        (friend) =>
          friend.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
          (!data.isOwnPage ||
            !togetherOnly ||
            matchesStatus !== 'ready' ||
            sharedWith(friend.id).length > 0)
      )
      .sort(
        (a, b) =>
          (data.isOwnPage && matches ? sharedWith(b.id).length - sharedWith(a.id).length : 0) ||
          a.name.localeCompare(b.name)
      )
  );

  const listUrl = (name: string) => `/user/anilist/${encodeURIComponent(name)}`;
  const people = (count: number) =>
    `${count.toLocaleString()} ${count === 1 ? 'person' : 'people'}`;
</script>

<AutoReadRetry
  retryKey={`own-friends:${data.user.id}:${data.isOwnPage}`}
  {retryAt}
  recovered={anime !== null}
  onretry={() => refresh++}
/>

<section class="friends-page">
  <header class="friends-header">
    <div class="heading-copy">
      <h1>
        {data.isOwnPage ? 'Your friends' : `${data.user.name}'s friends`}
      </h1>
      <p class="summary">
        {people(data.total)}
        {data.isOwnPage ? 'you follow' : `${data.user.name} follows`} on AniList
      </p>
    </div>
    <a class="back-link" href={listUrl(data.user.name)}
      ><span aria-hidden="true">←</span>
      {data.isOwnPage ? 'Your watching list' : `${data.user.name}'s list`}</a
    >
  </header>

  {#if data.friends.length === 0}
    <div class="empty-state">
      <h2>No friends yet</h2>
      <p>
        {data.isOwnPage
          ? 'Follow people on AniList to see what you’re watching together.'
          : `${data.user.name} isn't following anyone on AniList yet.`}
      </p>
    </div>
  {:else}
    {#key data.user.id}
      <TasteTwins owner={data.user.name} friends={data.friends} own={data.isOwnPage} />
    {/key}

    <div class="friends-toolbar">
      <div class="view-switch" aria-label="Filter friends">
        <button
          type="button"
          class:active={!togetherOnly || !data.isOwnPage || matchesStatus !== 'ready'}
          aria-pressed={!togetherOnly || !data.isOwnPage || matchesStatus !== 'ready'}
          onclick={() => (togetherOnly = false)}
          >All friends <span>{data.friends.length}</span></button
        >
        {#if data.isOwnPage}
          <button
            type="button"
            class:active={togetherOnly && matchesStatus === 'ready'}
            aria-pressed={togetherOnly && matchesStatus === 'ready'}
            disabled={matchesStatus !== 'ready'}
            onclick={() => (togetherOnly = true)}
            >Watching together <span
              >{matches ? togetherCount : matchesStatus === 'unavailable' ? '—' : '…'}</span
            ></button
          >
        {/if}
      </div>
      <label class="friend-search">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg
        >
        <input
          type="search"
          bind:value={search}
          placeholder="Find a friend"
          aria-label="Search friends"
        />
      </label>
    </div>

    {#if data.isOwnPage}
      {#if anime}
        <FriendsWatchingLoader
          refreshOnReturn={false}
          viewerId={data.user.id}
          mediaIds={anime.map((entry) => entry.id)}
          onresult={(result) => (matches = result)}
          onstatus={(status) => (matchesStatus = status)}
        />
      {:else if message}
        <p class="load-note" role="status">
          {message}
          <button
            type="button"
            class="tw:btn tw:btn-xs"
            disabled={now < retryAt}
            onclick={() => refresh++}
            >{now < retryAt ? `Retry in ${Math.ceil((retryAt - now) / 1000)}s` : 'Retry'}</button
          >
        </p>
      {:else}<p class="load-note" role="status">Finding the anime you share…</p>{/if}
    {/if}

    <ul class="friends-grid">
      {#each visibleFriends as friend (friend.id)}
        {@const shared = sharedWith(friend.id)}
        <li class="friend-tile">
          <a
            class="friend-profile"
            href={listUrl(friend.name)}
            aria-label={`${friend.name}'s watching list`}
          >
            <span class="profile-avatar"><FriendAvatar {...friend} size={40} /></span>
            <span class="friend-identity"
              ><strong>{friend.name}</strong><span
                >{data.isOwnPage && matches
                  ? shared.length
                    ? `${shared.length}${matches.partial ? '+' : ''} anime in common`
                    : matches.partial
                      ? 'No shared anime found'
                      : 'No shared anime yet'
                  : 'Watching list'}</span
              ></span
            >
          </a>
          {#if data.isOwnPage}
            <div class="shared-section">
              {#if matches && shared.length}
                <div class="poster-row">
                  {#each shared.slice(0, 3) as entry (entry.id)}<SharedAnimePoster
                      anime={entry}
                      compact
                      blurMature={data.preferences.blurMature}
                    />{/each}
                </div>
                <button
                  type="button"
                  class="view-shared"
                  onclick={() => (selectedFriend = friend.id)}
                  >View {shared.length === 1
                    ? 'anime'
                    : `all ${shared.length}${matches.partial ? '+' : ''}`}</button
                >
              {:else if matches}
                <div class="no-shared">
                  <a class="explore-anime" href={listUrl(friend.name)}>Explore anime</a>
                </div>
              {:else if matchesStatus === 'loading' && !message}<div
                  class="poster-skeleton"
                  aria-hidden="true"
                >
                  <span></span><span></span><span></span>
                </div>
              {:else}<a class="explore-anime" href={listUrl(friend.name)}>Explore anime</a>{/if}
            </div>
          {:else}<a class="explore-anime" href={listUrl(friend.name)}>Explore anime</a>{/if}
        </li>
      {/each}
    </ul>
    {#if !visibleFriends.length}
      <div class="empty-state">
        <h2>{search.trim() ? 'No friends found' : 'No shared anime found'}</h2>
        <p>{search.trim() ? 'Try another name.' : 'Try browsing all your friends.'}</p>
        <button
          type="button"
          class="reset-button"
          onclick={() => {
            search = '';
            togetherOnly = false;
          }}>Show all friends</button
        >
      </div>
    {/if}
    {#if data.total > data.friends.length}<p class="load-note">
        Showing the first {data.friends.length.toLocaleString()} of {people(data.total)}.
      </p>{/if}
  {/if}
</section>

<SharedAnimeDialog
  selection={sharedSelection}
  blurMature={data.preferences.blurMature}
  partial={matches?.partial ?? false}
  onclose={() => (selectedFriend = null)}
/>

<style>
  .friends-page {
    width: 100%;
    max-width: 70rem;
    margin: 24px auto 0;
  }
  .friends-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 22px;
  }
  h1 {
    color: var(--text-heading);
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .summary {
    margin-top: 10px;
    font-size: 0.86rem;
    opacity: 1;
    color: var(--text-accent);
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text-accent);
    font-size: 0.8rem;
    font-weight: 600;
    flex: none;
  }
  .back-link:hover {
    background: var(--you-blue-pale);
    border-color: var(--you-blue);
  }
  .friends-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
  }
  .view-switch {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface-muted);
  }
  .view-switch button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 4px;
    font-size: 0.8125rem;
    color: var(--text-accent);
    font-weight: 650;
    cursor: pointer;
    min-height: 40px;
  }
  .view-switch button.active {
    background: var(--surface);
    color: var(--you-blue);
    box-shadow: none;
  }
  .view-switch button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .view-switch button > span {
    min-width: 21px;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--you-blue-pale);
    font-size: 0.65rem;
    font-variant-numeric: tabular-nums;
  }
  .friend-search {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 14px;
    width: 220px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    color: var(--text-accent);
    background: var(--surface);
    min-height: 44px;
  }
  .friend-search:focus-within {
    outline: 2px solid var(--you-blue);
    outline-offset: 2px;
  }
  .friend-search input {
    width: 100%;
    min-width: 0;
    font-size: 0.8rem;
    outline: none;
    color: var(--color-base-content);
    background: transparent;
  }
  .friends-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
    gap: 14px;
    list-style: none;
    padding: 0;
  }
  .friend-tile {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    height: 112px;
    padding: 14px;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: none;
    transition: border-color 150ms ease;
  }
  .friend-tile:hover {
    translate: none;
    box-shadow: none;
    border-color: var(--you-blue);
  }
  .friend-profile {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    border-radius: 8px;
  }
  .profile-avatar {
    display: flex;
    flex: none;
    border: 2px solid var(--surface);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--border-subtle);
  }
  .friend-identity {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .friend-identity strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-heading);
    font-size: 0.88rem;
    font-weight: 600;
    letter-spacing: -0.025em;
  }
  .friend-identity > span {
    color: var(--text-accent);
    font-size: 0.75rem;
    line-height: 1.4;
    opacity: 1;
  }
  .friend-profile:hover .friend-identity strong {
    color: var(--text-accent);
    text-decoration: underline;
    text-underline-offset: 3px;
    font-weight: 600;
  }
  .shared-section {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
    width: 120px;
    min-width: 0;
  }
  .poster-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    height: 48px;
    width: 100%;
  }
  .poster-row > :global(a) {
    width: 36px;
    flex: none;
  }
  .view-shared {
    padding: 2px 0;
    border-radius: 4px;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    min-height: 28px;
  }
  .no-shared {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }
  .explore-anime {
    position: relative;
    padding: 8px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    color: var(--text-accent);
    background: var(--surface);
    font-size: 0.75rem;
    font-weight: 650;
    white-space: nowrap;
  }
  .explore-anime:hover {
    background: var(--you-blue-pale);
    border-color: var(--you-blue);
  }
  .poster-skeleton {
    display: flex;
    gap: 6px;
  }
  .poster-skeleton span {
    width: 36px;
    height: 48px;
    border-radius: 6px;
    background: var(--you-blue-pale);
  }
  .load-note {
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-accent);
    margin: 16px 0;
  }
  .empty-state {
    padding: 60px 20px;
    text-align: center;
  }
  .empty-state h2 {
    color: var(--text-heading);
    font-size: 1.15rem;
    font-weight: 700;
  }
  .empty-state p {
    opacity: 0.65;
    font-size: 0.85rem;
    margin-top: 8px;
  }
  .reset-button {
    margin-top: 20px;
    color: var(--text-accent);
    text-decoration: underline;
    cursor: pointer;
    font-size: 0.8rem;
  }
  a:focus-visible,
  button:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 3px;
    border-radius: 8px;
  }
  @media (max-width: 620px) {
    .friends-page {
      margin-top: 10px;
    }
    .friends-header {
      align-items: flex-start;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 24px;
    }
    .friends-toolbar {
      flex-direction: column-reverse;
      align-items: stretch;
      gap: 12px;
    }
    .friend-search {
      width: 100%;
    }
    .view-switch {
      width: max-content;
      max-width: 100%;
      border-radius: var(--radius-control);
    }
    .view-switch button {
      padding: 8px 11px;
    }
    .friends-grid {
      gap: 16px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .friend-tile {
      transition: none;
    }
    .friend-tile:hover {
      translate: none;
    }
  }
</style>
