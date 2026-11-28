<script lang="ts">
  import FriendsSkeleton from '#lib/components/skeletons/FriendsSkeleton.svelte';
  import ListSkeleton from '#lib/components/skeletons/ListSkeleton.svelte';
  import PlanningSkeleton from '#lib/components/skeletons/PlanningSkeleton.svelte';
  import SyncSkeleton from '#lib/components/skeletons/SyncSkeleton.svelte';
  import type { SkeletonKind } from '#lib/navigation-skeleton.js';
  import type { CardSize } from '#lib/types/preferences.js';

  let {
    kind,
    cardSize,
    own,
    anilist,
  }: {
    kind: SkeletonKind;
    cardSize: CardSize;
    /** A list of the viewer's own, which has more buttons */
    own: boolean;
    /** An AniList list rather than a MyAnimeList one */
    anilist: boolean;
  } = $props();
</script>

<!-- The page being loaded, in outline -->
{#if kind === 'list' || kind === 'calendar'}
  <ListSkeleton calendar={kind === 'calendar'} {cardSize} {own} {anilist} />
{:else if kind === 'planning'}
  <PlanningSkeleton />
{:else if kind === 'friends'}
  <FriendsSkeleton />
{:else}
  <SyncSkeleton />
{/if}
