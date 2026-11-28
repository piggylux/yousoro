<script lang="ts">
  import { page } from '$app/state';

  import PageError from '#lib/components/PageError.svelte';
  import FriendsSkeleton from '#lib/components/skeletons/FriendsSkeleton.svelte';
  import ListSkeleton from '#lib/components/skeletons/ListSkeleton.svelte';
  import PlanningSkeleton from '#lib/components/skeletons/PlanningSkeleton.svelte';
  import { ownsList } from '#lib/navigation-skeleton.js';

  // The list's pages that can answer before what they show (see first-load.ts)
  const PLANNING = '/user/[domain]/[username]/planning';
  const FRIENDS = '/user/[domain]/[username]/friends';
  const name = $derived(page.params.username);
  const what = $derived(
    page.route.id === PLANNING
      ? `${name}’s planning list`
      : page.route.id === FRIENDS
        ? `${name}’s friends`
        : `${name}’s list`
  );
</script>

<PageError heading={page.status === 404 ? 'List not found' : 'Unable to load this list'} {what}>
  {#snippet loading()}
    {#if page.route.id === PLANNING}
      <PlanningSkeleton />
    {:else if page.route.id === FRIENDS}
      <FriendsSkeleton />
    {:else}
      <ListSkeleton
        calendar={page.url.searchParams.get('view') === 'calendar'}
        cardSize={page.data.preferences?.cardSize}
        own={ownsList(page.params, page.data)}
        anilist={page.params.domain !== 'myanimelist'}
      />
    {/if}
  {/snippet}
</PageError>
