<script lang="ts">
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';

  import { activityReactions, describeActivity, reusesActivity } from '#lib/activity.js';
  import FeedMenu from '#lib/components/FeedMenu.svelte';
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import type { PopoverTriggerProps } from '#lib/components/Popover.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import type { ActivityPage, FriendActivity } from '#lib/types/activity.js';

  let {
    trigger,
  }: {
    /** The header's button, with the dropdown's props spread on it */
    trigger: Snippet<[{ open: boolean; props: PopoverTriggerProps }]>;
  } = $props();

  function readPage(body: unknown) {
    const result = body as ActivityPage;
    return { items: result.activities, hasNextPage: result.hasNextPage };
  }

  function describe(activity: FriendActivity) {
    return {
      title: activity.media.title ?? 'An anime',
      summary: describeActivity(activity),
      detail: activityReactions(activity),
    };
  }

  const showMature = $derived(page.data.preferences?.showMature ?? false);
</script>

<FeedMenu
  {trigger}
  heading="Friends' activity"
  anilistUrl="https://anilist.co/home"
  noun="friends' activity"
  empty="Nothing yet. When people you follow on AniList update their anime, it shows up here."
  retryKey="activity"
  fetchPage={(pageNumber) => fetch(`/api/activity?page=${pageNumber}`)}
  {readPage}
  reuse={(loadedAt) => reusesActivity(loadedAt, Date.now())}
  {describe}
  countLabel={(count) => `${count} ${count === 1 ? 'update' : 'updates'}`}
>
  {#snippet thumbnail(activity)}
    <!-- Their anime, with their avatar on its corner -->
    <span class="cover">
      <SharedAnimePoster
        anime={{
          id: activity.media.id,
          title: activity.media.title ?? '?',
          isAdult: activity.media.isAdult,
          coverUrl: activity.media.coverUrl,
        }}
        blurMature={!showMature}
        compact
        decorative
      />
      <span class="who"><FriendAvatar {...activity.user} size={22} /></span>
    </span>
  {/snippet}
</FeedMenu>

<style>
  /* The avatar overhangs the cover's corner into the row's gap and padding */
  .cover {
    position: relative;
    display: block;
  }
  .who {
    position: absolute;
    right: -8px;
    bottom: -6px;
    display: grid;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--surface);
  }
</style>
