import { describe, expect, it } from 'vitest';

import {
  describeNotification,
  groupByDay,
  isNotificationType,
  notificationDetail,
  REUSE_NOTIFICATIONS_FOR_MS,
  reusesNotifications,
  unreadBadgeText,
  unreadBeforeRead,
} from '#lib/notifications.js';
import {
  NOTIFICATION_TYPES,
  type AppNotification,
  type NotificationType,
} from '#lib/types/notification.js';

const alice = { id: 7, name: 'Alice', avatarUrl: null };
const frieren = { id: 154587, title: 'Sousou no Frieren', coverUrl: null, isAdult: false };

function notification(type: NotificationType, fields: Partial<AppNotification> = {}) {
  return { id: 1, type, createdAt: 0, href: null, ...fields } satisfies AppNotification;
}

/** What it says, as "title — summary" */
function said(notification: AppNotification) {
  const { title, summary } = describeNotification(notification);
  return `${title} — ${summary}`;
}

describe('isNotificationType', () => {
  it("knows AniList's own types only", () => {
    expect(NOTIFICATION_TYPES.every(isNotificationType)).toBe(true);
    expect(isNotificationType('SOMETHING_NEW')).toBe(false);
    expect(isNotificationType(undefined)).toBe(false);
  });
});

describe('describeNotification', () => {
  it.each<[NotificationType, Partial<AppNotification>, string]>([
    ['AIRING', { media: frieren, episode: 7 }, 'Sousou no Frieren — Episode 7 aired'],
    ['AIRING', { media: frieren }, 'Sousou no Frieren — A new episode aired'],
    ['FOLLOWING', { actor: alice }, 'Alice — Followed you'],
    ['ACTIVITY_MESSAGE', { actor: alice }, 'Alice — Sent you a message'],
    ['ACTIVITY_MENTION', { actor: alice }, 'Alice — Mentioned you in an activity'],
    ['ACTIVITY_REPLY', { actor: alice }, 'Alice — Replied to your activity'],
    [
      'ACTIVITY_REPLY_SUBSCRIBED',
      { actor: alice },
      "Alice — Replied to an activity you're subscribed to",
    ],
    ['ACTIVITY_LIKE', { actor: alice }, 'Alice — Liked your activity'],
    ['ACTIVITY_REPLY_LIKE', { actor: alice }, 'Alice — Liked your reply'],
    [
      'THREAD_COMMENT_MENTION',
      { actor: alice, subject: 'Fall 2026' },
      'Alice — Mentioned you in Fall 2026',
    ],
    ['THREAD_SUBSCRIBED', { actor: alice, subject: 'Fall 2026' }, 'Alice — Commented in Fall 2026'],
    [
      'THREAD_COMMENT_REPLY',
      { actor: alice, subject: 'Fall 2026' },
      'Alice — Replied to your comment in Fall 2026',
    ],
    [
      'THREAD_COMMENT_LIKE',
      { actor: alice, subject: 'Fall 2026' },
      'Alice — Liked your comment in Fall 2026',
    ],
    ['THREAD_LIKE', { actor: alice, subject: 'Fall 2026' }, 'Alice — Liked your thread Fall 2026'],
    [
      'RELATED_MEDIA_ADDITION',
      { media: frieren },
      'Sousou no Frieren — New on AniList, related to your list',
    ],
    ['MEDIA_DATA_CHANGE', { media: frieren }, 'Sousou no Frieren — Updated on AniList'],
    [
      'MEDIA_MERGE',
      { media: frieren, subject: 'Frieren (TV)' },
      'Sousou no Frieren — Merged with Frieren (TV)',
    ],
    ['MEDIA_DELETION', { subject: 'Frieren Recap' }, 'Frieren Recap — Removed from AniList'],
    [
      'MEDIA_SUBMISSION_UPDATE',
      { subject: 'Sousou no Frieren' },
      'Sousou no Frieren — Your submission was reviewed',
    ],
    [
      'STAFF_SUBMISSION_UPDATE',
      { subject: 'Kana Ichinose' },
      'Kana Ichinose — Your submission was reviewed',
    ],
    ['CHARACTER_SUBMISSION_UPDATE', {}, 'Your submission — Reviewed on AniList'],
  ])('says what %s means', (type, fields, expected) => {
    expect(said(notification(type, fields))).toBe(expected);
  });

  it('still reads when AniList left out who or what it was about', () => {
    expect(said(notification('ACTIVITY_LIKE'))).toBe('Someone — Liked your activity');
    expect(said(notification('AIRING', { episode: 3 }))).toBe('An anime — Episode 3 aired');
    expect(said(notification('THREAD_COMMENT_REPLY', { actor: alice }))).toBe(
      'Alice — Replied to your comment in a forum thread'
    );
    expect(said(notification('THREAD_LIKE', { actor: alice }))).toBe(
      'Alice — Liked your forum thread'
    );
    expect(said(notification('MEDIA_DELETION'))).toBe(
      'A title on your list — Removed from AniList'
    );
  });
});

describe('groupByDay', () => {
  // Local times, so the tests pass in any time zone
  const now = new Date(2026, 10, 27, 12, 0).getTime();
  const at = (day: number, hour: number) => ({
    createdAt: new Date(2026, 10, day, hour).getTime(),
  });

  it('puts notifications under today, yesterday, this week and earlier, newest first', () => {
    const today = [at(27, 11), at(27, 0)];
    const yesterday = [at(26, 23), at(26, 1)];
    const thisWeek = [at(25, 18), at(21, 18)];
    const earlier = [at(20, 18), at(1, 9)];
    expect(groupByDay([...today, ...yesterday, ...thisWeek, ...earlier], now)).toEqual([
      { day: 'Today', notifications: today },
      { day: 'Yesterday', notifications: yesterday },
      { day: 'This week', notifications: thisWeek },
      { day: 'Earlier', notifications: earlier },
    ]);
  });

  it('leaves out days with nothing in them', () => {
    expect(groupByDay([at(27, 9), at(10, 9)], now).map(({ day }) => day)).toEqual([
      'Today',
      'Earlier',
    ]);
    expect(groupByDay([], now)).toEqual([]);
  });

  it('counts a time a little ahead of the clock as today', () => {
    expect(groupByDay([{ createdAt: now + 60_000 }], now)[0].day).toBe('Today');
  });

  it('gives each day once, in order, when AniList sends one out of order', () => {
    const today = at(27, 9);
    const old = at(1, 9);
    const thisWeek = at(24, 9);
    const older = at(2, 9);
    expect(groupByDay([today, old, thisWeek, older], now)).toEqual([
      { day: 'Today', notifications: [today] },
      { day: 'This week', notifications: [thisWeek] },
      { day: 'Earlier', notifications: [old, older] },
    ]);
  });
});

describe('reusesNotifications', () => {
  const loadedAt = 1_000_000;
  const shown = { loaded: true, loadedAt, bellUnread: 0, now: loadedAt + 60_000 };

  it('shows what it loaded a little while ago when nothing new came', () => {
    expect(reusesNotifications(shown)).toBe(true);
  });

  it('asks AniList again when the bell has new ones, the last read failed, or a while passed', () => {
    expect(reusesNotifications({ ...shown, bellUnread: 2 })).toBe(false);
    expect(reusesNotifications({ ...shown, loaded: false })).toBe(false);
    expect(reusesNotifications({ ...shown, now: loadedAt + REUSE_NOTIFICATIONS_FOR_MS })).toBe(
      false
    );
  });
});

describe('unreadBeforeRead', () => {
  it("prefers AniList's own count from the read, which is fresher than the bell's", () => {
    expect(unreadBeforeRead(2, 5)).toBe(2);
    expect(unreadBeforeRead(7, 5)).toBe(7);
  });

  it("falls back to the bell's count when AniList says none, as it may have counted after clearing", () => {
    expect(unreadBeforeRead(0, 3)).toBe(3);
    expect(unreadBeforeRead(undefined, 3)).toBe(3);
  });
});

describe('notificationDetail', () => {
  it('says how a submission went and why, as one line', () => {
    expect(
      notificationDetail(
        notification('MEDIA_SUBMISSION_UPDATE', { status: 'PARTIALLY_ACCEPTED', reason: 'Thanks!' })
      )
    ).toBe('Partially accepted · Thanks!');
  });

  it('has nothing to add without a status or reason', () => {
    expect(notificationDetail(notification('AIRING'))).toBeNull();
    expect(notificationDetail(notification('MEDIA_DATA_CHANGE', { reason: '  ' }))).toBeNull();
  });
});

describe('unreadBadgeText', () => {
  it('keeps the count to three characters', () => {
    expect(unreadBadgeText(1)).toBe('1');
    expect(unreadBadgeText(99)).toBe('99');
    expect(unreadBadgeText(100)).toBe('99+');
  });
});
