/**
 * The bell's count of unread AniList notifications. AniList can't tell the page when one arrives,
 * so it's asked when a page loads and when the tab comes back into view, at most once a minute:
 * every visitor shares the app's AniList budget. A failed check keeps the count the bell had
 */
const CHECK_EVERY_MS = 60_000;

export const notificationCount = $state<{ unread: number }>({ unread: 0 });

let userId: number | null = null;
let checkedAt = 0;
let pending: Promise<void> | null = null;
// Bumped when the count is set some other way, so an answer asked for before then is dropped
let generation = 0;

/** Starts over for the AniList account signed in now, or none */
export function resetForUser(id: number | null) {
  if (id === userId) return;
  userId = id;
  generation++;
  checkedAt = 0;
  pending = null;
  notificationCount.unread = 0;
}

async function askCount(asked: number) {
  try {
    const response = await fetch('/api/notifications/unread');
    // 204 when the sign-in has run out, which the page's own reads report
    if (response.status !== 200) return;
    const { unread } = await response.json();
    if (asked === generation && Number.isSafeInteger(unread) && unread >= 0) {
      notificationCount.unread = unread;
    }
  } catch {
    // Offline, or AniList is busy: the next check tries again
  }
}

/** Asks AniList for the count, unless it was asked within the last minute */
export function refreshUnread(): Promise<void> {
  if (userId === null || document.hidden || pending) return pending ?? Promise.resolve();
  if (Date.now() - checkedAt < CHECK_EVERY_MS) return Promise.resolve();
  checkedAt = Date.now();
  const request = askCount(generation).finally(() => {
    if (pending === request) pending = null;
  });
  pending = request;
  return request;
}

/** Opening the notifications marked them all read on AniList */
export function markAllRead() {
  generation++;
  checkedAt = Date.now();
  pending = null;
  notificationCount.unread = 0;
}
