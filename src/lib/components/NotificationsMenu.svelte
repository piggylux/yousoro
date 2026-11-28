<script lang="ts">
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';

  import FeedMenu from '#lib/components/FeedMenu.svelte';
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import type { PopoverTriggerProps } from '#lib/components/Popover.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { markAllRead, notificationCount } from '#lib/notification-count.svelte.js';
  import {
    describeNotification,
    notificationDetail,
    reusesNotifications,
    unreadBeforeRead,
  } from '#lib/notifications.js';
  import type { AppNotification, NotificationsPage } from '#lib/types/notification.js';

  let {
    trigger,
  }: {
    /** The bell, styled by the header, with the dropdown's props spread on it */
    trigger: Snippet<[{ open: boolean; props: PopoverTriggerProps }]>;
  } = $props();

  // Whether the dropdown is open
  let open = false;
  /** How many were unread when they were last asked for: the newest ones */
  let unread = $state(0);
  // Whether the newest ones have shown since they loaded, which a load that ends after the dropdown
  // closed hasn't
  let seen = false;

  function fetchPage(pageNumber: number) {
    // The first page marks them read, as opening them on AniList does
    if (pageNumber > 1) return fetch(`/api/notifications?page=${pageNumber}`);
    // What the bell says now is what was unread before this read
    unread = notificationCount.unread;
    return fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  }

  function readPage(body: unknown, pageNumber: number) {
    const result = body as NotificationsPage;
    if (pageNumber === 1) {
      unread = unreadBeforeRead(result.unread, unread);
      seen = open;
      markAllRead();
    }
    return { items: result.notifications, hasNextPage: result.hasNextPage };
  }

  function reuse(loadedAt: number) {
    const reused = reusesNotifications({
      loaded: true,
      loadedAt,
      bellUnread: notificationCount.unread,
      now: Date.now(),
    });
    if (reused) {
      // Shown before, so no longer new; or showing now for the first time, still new
      if (seen) unread = 0;
      seen = true;
    }
    return reused;
  }

  function describe(notification: AppNotification, index: number) {
    return {
      ...describeNotification(notification),
      detail: notificationDetail(notification),
      // The newest ones, as many as were unread
      isNew: index < unread,
    };
  }

  function countLabel(count: number) {
    const label = `${count} ${count === 1 ? 'notification' : 'notifications'}`;
    const fresh = Math.min(unread, count);
    return fresh ? `${label}, ${fresh} new` : label;
  }

  const showMature = $derived(page.data.preferences?.showMature ?? false);
</script>

<FeedMenu
  {trigger}
  heading="Notifications"
  anilistUrl="https://anilist.co/notifications"
  noun="notifications"
  empty="No notifications yet."
  retryKey="notifications"
  {fetchPage}
  {readPage}
  {reuse}
  {describe}
  {countLabel}
  ontoggle={(opening) => (open = opening)}
>
  {#snippet thumbnail(notification)}
    {#if notification.media}
      <SharedAnimePoster
        anime={{
          id: notification.media.id,
          title: notification.media.title ?? '?',
          isAdult: notification.media.isAdult,
          coverUrl: notification.media.coverUrl,
        }}
        blurMature={!showMature}
        compact
        decorative
      />
    {:else if notification.actor}
      <FriendAvatar {...notification.actor} size={40} />
    {:else}
      <span class="icon">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path
            d="M10.3 21a1.94 1.94 0 0 0 3.4 0"
          /></svg
        >
      </span>
    {/if}
  {/snippet}
</FeedMenu>

<style>
  .icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--surface-muted);
    color: var(--text-accent);
  }
</style>
