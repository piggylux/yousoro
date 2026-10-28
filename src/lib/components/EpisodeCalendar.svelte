<script lang="ts">
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fly } from 'svelte/transition';

  import {
    addCalendarDays,
    advanceCalendarWindow,
    calendarEpisodes,
    calendarWeek,
    sameCalendarDay,
    startOfWeek,
  } from '#lib/calendar.js';
  import { clock } from '#lib/clock.js';
  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import ScheduleDayDialog from '#lib/components/ScheduleDayDialog.svelte';
  import ScheduledEpisodeLink from '#lib/components/ScheduledEpisodeLink.svelte';
  import UnscheduledAnimeLink from '#lib/components/UnscheduledAnimeLink.svelte';
  import { trackDayScroll } from '#lib/day-scroll.js';
  import {
    getScheduleRetryAt,
    loadSchedule,
    scheduleExpired,
    ScheduleUnavailable,
  } from '#lib/schedule.js';
  import type { Anime } from '#lib/types/anime.js';
  import type { ScheduleResult } from '#lib/types/schedule.js';

  let {
    anime,
    blurMature = true,
    contextKey = 'public',
  }: { anime: Anime[]; blurMature?: boolean; contextKey?: string } = $props();
  const heading = $props.id();
  let start = $state<Date | null>(null);
  let weekIndex = $state(0);
  let direction = $state(1);
  let timezone = $state('');
  let result = $state<ScheduleResult | null>(null);
  let loadedKey = $state('');
  let loading = $state(false);
  let unavailable = $state(false);
  let retryRevision = $state(0);
  let lastRevision = 0;
  let retryUntil = $state(0);
  let timerNow = $state(Date.now());
  let selectedDate = $state<Date | null>(null);
  const mediaIds = $derived([...new Set(anime.map((entry) => entry.id))].sort((a, b) => a - b));
  const mediaKey = $derived(mediaIds.join(','));
  const from = $derived(start ? Math.floor(start.getTime() / 1000) : 0);
  const until = $derived(start ? Math.floor(addCalendarDays(start, 28).getTime() / 1000) : 0);
  const requestKey = $derived(`${contextKey}:${from}:${until}:${mediaKey}`);
  const expiredFallback = $derived(loadedKey === requestKey && scheduleExpired(result, clock.now));
  const currentResult = $derived(loadedKey === requestKey && !expiredFallback ? result : null);
  const week = $derived(start ? addCalendarDays(start, weekIndex * 7) : null);
  const episodes = $derived(
    calendarEpisodes(
      anime,
      currentResult?.episodes ?? null,
      clock.now,
      Boolean(currentResult?.partial || currentResult?.stale),
      currentResult?.stale
    )
  );
  const days = $derived(week ? calendarWeek(episodes, week) : []);
  const total = $derived(days.reduce((count, day) => count + day.episodes.length, 0));
  const incomplete = $derived(!currentResult || currentResult.partial || currentResult.stale);
  const scheduledIds = $derived(
    new Set(
      episodes
        .filter((episode) => episode.airsAt >= from * 1000 && episode.airsAt < until * 1000)
        .map((episode) => episode.anime.id)
    )
  );
  const unscheduled = $derived(anime.filter((entry) => !scheduledIds.has(entry.id)));
  const selection = $derived(
    selectedDate ? (days.find((day) => sameCalendarDay(day.date, selectedDate!)) ?? null) : null
  );
  const retrySeconds = $derived(Math.max(0, Math.ceil((retryUntil - timerNow) / 1000)));
  const dateLabel = (date: Date) =>
    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const weekChoices = $derived(
    start
      ? Array.from({ length: 4 }, (_, index) => ({
          index,
          label: ['This week', 'Next week', 'In 2 weeks', 'In 3 weeks'][index],
          range: `${dateLabel(addCalendarDays(start!, index * 7))} – ${dateLabel(addCalendarDays(start!, index * 7 + 6))}`,
        }))
      : []
  );
  onMount(() => {
    start = startOfWeek(new Date());
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  });

  $effect(() => {
    if (!start) return;
    const next = advanceCalendarWindow(start, weekIndex, new Date(clock.now));
    if (next.start.getTime() === start.getTime()) return;
    start = next.start;
    weekIndex = next.weekIndex;
    selectedDate = null;
  });

  $effect(() => {
    const key = requestKey;
    const ids = mediaKey ? mediaKey.split(',').map(Number) : [];
    const first = from;
    const last = until;
    const refresh = lastRevision !== retryRevision;
    lastRevision = retryRevision;
    if (!first) return;
    let obsolete = false;
    selectedDate = null;
    loading = true;
    unavailable = false;
    // Week navigation is deliberately absent from these dependencies.
    void loadSchedule(ids, first, last, refresh)
      .then((data) => {
        if (obsolete) return;
        result = data;
        loadedKey = key;
        retryUntil = getScheduleRetryAt() > Date.now() ? getScheduleRetryAt() : 0;
        timerNow = Date.now();
      })
      .catch((err) => {
        if (obsolete) return;
        unavailable = true;
        retryUntil =
          err instanceof ScheduleUnavailable && err.retryAt > Date.now() ? err.retryAt : 0;
        timerNow = Date.now();
      })
      .finally(() => {
        if (!obsolete) loading = false;
      });
    return () => {
      obsolete = true;
    };
  });
  $effect(() => {
    const end = retryUntil;
    if (end <= Date.now()) return;
    const timer = setInterval(() => {
      timerNow = Date.now();
      if (Date.now() >= end) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  });
  function changeWeek(index: number) {
    if (index < 0 || index > 3 || index === weekIndex) return;
    selectedDate = null;
    direction = index > weekIndex ? 1 : -1;
    weekIndex = index;
  }

  function scrollDay(event: MouseEvent) {
    const day = (event.currentTarget as HTMLElement).closest<HTMLElement>('.day')!;
    const list = day.querySelector<HTMLElement>('.day-episodes')!;
    list.scrollTo({
      top: day.hasAttribute('data-at-end') ? 0 : list.scrollTop + list.clientHeight * 0.8,
      behavior: prefersReducedMotion.current ? 'instant' : 'smooth',
    });
  }
</script>

<section class="calendar" aria-label="Episode schedule">
  <div class="calendar-heading">
    <div>
      <h1>Episode calendar</h1>
      <p class="description">Airing times from AniList · {timezone || 'Your local time zone'}</p>
    </div>
  </div>
  {#if start && week}
    <div class="coverage">
      <p>
        {dateLabel(start)} – {dateLabel(addCalendarDays(start, 27))}, {addCalendarDays(
          start,
          27
        ).getFullYear()} · Watching &amp; Rewatching
      </p>
    </div>
    <p class="schedule-note">
      Confirmed air dates only. Dates may change, and streaming availability can differ.
    </p>
    {#if loading}<p class="notice" role="status">
        Loading the four-week schedule. Showing next known episodes while it loads.
      </p>
    {:else if unavailable || expiredFallback}<div class="notice" role="status">
        <span
          >{expiredFallback ? 'Saved schedule expired.' : 'Full schedule unavailable.'}
          {currentResult
            ? 'Showing previously loaded air dates.'
            : 'Showing next known episodes only.'}</span
        ><button type="button" disabled={retrySeconds > 0} onclick={() => retryRevision++}
          >{retrySeconds ? `Retry in ${retrySeconds}s` : 'Retry'}</button
        >
      </div>
    {:else if currentResult?.stale}<div class="notice" role="status">
        <span
          >Showing saved air dates (up to 24 hours old). Some dates could not be refreshed and may
          have changed.</span
        ><button type="button" disabled={retrySeconds > 0} onclick={() => retryRevision++}
          >{retrySeconds ? `Retry in ${retrySeconds}s` : 'Retry'}</button
        >
      </div>
    {:else if currentResult?.partial}<div class="notice" role="status">
        <span
          >{currentResult.partialReason === 'limit'
            ? 'Large schedule: not all air dates could be loaded. Some episodes may be missing from this four-week view.'
            : 'Incomplete schedule: AniList could not return all air dates. Some episodes may be missing.'}</span
        >{#if currentResult.partialReason !== 'limit'}<button
            type="button"
            disabled={retrySeconds > 0}
            onclick={() => retryRevision++}
            >{retrySeconds ? `Retry in ${retrySeconds}s` : 'Retry'}</button
          >{/if}
      </div>
    {/if}
    <div
      class="week-picker"
      role="group"
      aria-label="Choose a week in the four-week schedule"
      aria-describedby="{heading}-week-hint"
      style:--selected-week={weekIndex}
      style:--active-column={weekIndex % 2}
      style:--active-row={Math.floor(weekIndex / 2)}
    >
      {#each weekChoices as choice (choice.index)}
        <button
          class="week-choice"
          type="button"
          aria-pressed={weekIndex === choice.index}
          aria-label={`Show ${choice.label.toLowerCase()}, ${choice.range}`}
          onclick={() => changeWeek(choice.index)}
        >
          <span class="week-choice-label">{choice.label}</span>
          <span class="week-choice-dates">{choice.range}</span>
        </button>
      {/each}
    </div>
    <p class="week-hint" id="{heading}-week-hint">Select a week to see its airing schedule.</p>
    <div class="week-summary" aria-live="polite" aria-atomic="true">
      <h2>{dateLabel(week)} – {dateLabel(addCalendarDays(week, 6))}</h2>
      <span
        >Week {weekIndex + 1} of 4 · {total}{incomplete ? '+' : ''} scheduled {total === 1
          ? 'episode'
          : 'episodes'}</span
      >
    </div>
    <div class="calendar-stage" aria-busy={loading}>
      {#key week.getTime()}
        <div
          class="week-grid"
          in:fly={{
            x: direction * 28,
            duration: prefersReducedMotion.current ? 0 : 200,
            opacity: 0,
          }}
        >
          {#each days as day (day.date.getTime())}
            {@const today = sameCalendarDay(day.date, new Date(clock.now))}
            <section
              class="day"
              use:trackDayScroll={day.episodes.length}
              class:today
              aria-label={day.date.toLocaleDateString(undefined, { dateStyle: 'full' })}
            >
              <div class="day-heading">
                <div class="day-heading-copy">
                  <div class="day-name">
                    {day.date.toLocaleDateString(undefined, { weekday: 'short' })}{#if today}<span
                        class="today-label">Today</span
                      >{/if}
                  </div>
                  <p class="day-summary">
                    {day.episodes.length}{incomplete ? '+' : ''}
                    {day.episodes.length === 1 ? 'episode' : 'episodes'}
                  </p>
                </div>
                <span class="day-number" aria-current={today ? 'date' : undefined}
                  >{day.date.getDate()}</span
                >
              </div>
              <div
                class="day-episodes"
                role="region"
                aria-label={`Episodes for ${day.date.toLocaleDateString(undefined, { dateStyle: 'full' })}`}
              >
                {#each day.episodes as entry, index (`${entry.anime.id}:${entry.episode}`)}<div
                    class="day-entry"
                    class:preview-hidden={index >= 3}
                  >
                    <ScheduledEpisodeLink {entry} {blurMature} />
                  </div>{:else}<p class="empty-day">
                    {incomplete ? 'No known episodes' : 'No confirmed episodes'}
                  </p>{/each}
              </div>
              <button class="scroll-day" type="button" onclick={scrollDay}>
                <span class="scroll-more">More episodes ↓</span>
                <span class="scroll-top">Back to top ↑</span>
              </button>
              {#if day.episodes.length > 3}<button
                  class="view-all"
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`View all ${day.episodes.length} episodes for ${day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                  onclick={() => (selectedDate = day.date)}
                  ><span class="view-all-copy"
                    ><span>View all episodes</span><small>+{day.episodes.length - 3} more</small
                    ></span
                  ><svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg
                  ></button
                >{/if}
            </section>
          {/each}
        </div>
      {/key}
    </div>
    {#if !total}<p class="empty-week">
        {incomplete
          ? 'No air dates to show yet. The schedule above is incomplete.'
          : 'No confirmed episodes this week. Browse another week within the loaded range.'}
      </p>{/if}
    {#if !incomplete && unscheduled.length}
      <details class="unscheduled">
        <summary>
          <span class="unscheduled-icon" aria-hidden="true"
            ><svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><rect x="3" y="5" width="18" height="16" rx="3" /><path
                d="M7 3v4m10-4v4M3 11h18m-13 5h8"
              /></svg
            ></span
          >
          <span class="unscheduled-heading"
            ><strong
              >More from your list <span class="unscheduled-count">{unscheduled.length}</span
              ></strong
            ><span>No confirmed air dates in this four-week window</span></span
          >
          <svg
            class="unscheduled-chevron"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg
          >
        </summary>
        <p>
          Still on your list, just outside the schedule. Check each anime’s airing status below.
        </p>
        <ul>
          {#each unscheduled as entry (entry.id)}<li>
              <UnscheduledAnimeLink anime={entry} {blurMature} />
            </li>{/each}
        </ul>
      </details>
    {/if}
  {:else}<p role="status">Preparing your local calendar…</p>{/if}
</section>
<ScheduleDayDialog
  {selection}
  {blurMature}
  partial={incomplete}
  onclose={() => (selectedDate = null)}
/>
<AutoReadRetry
  retryKey={`schedule:${requestKey}`}
  retryAt={loading ? 0 : retryUntil}
  recovered={Boolean(
    currentResult && !currentResult.partial && !currentResult.stale && !loading && !unavailable
  )}
  onretry={() => retryRevision++}
/>

<style>
  /* As wide as the list, so the page doesn't shift when switching between them */
  .calendar {
    container: schedule / inline-size;
    width: 100%;
  }
  .calendar-heading,
  .week-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .calendar-heading {
    margin: 1rem 0 1.5rem;
  }
  h1 {
    color: var(--text-heading);
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    margin: 0.25rem 0;
  }
  .description,
  .schedule-note,
  .unscheduled > p {
    font-size: 0.8rem;
    opacity: 0.75;
  }
  .week-picker {
    position: relative;
    isolation: isolate;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
    padding: 5px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: none;
    max-width: 680px;
    margin-top: 20px;
  }
  .week-picker::before {
    content: '';
    position: absolute;
    top: 5px;
    left: 5px;
    width: calc((100% - 10px - 12px) / 4);
    height: calc(100% - 10px);
    border-radius: var(--radius-control);
    background: var(--you-blue-pale);
    box-shadow: none;
    transform: translateX(calc(var(--selected-week) * (100% + 4px)));
    transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }
  .week-choice {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 6px;
    min-height: 64px;
    padding: 10px 14px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-heading);
    text-align: left;
    transition: color 160ms ease;
  }
  .week-choice[aria-pressed='true'] {
    background: transparent;
    color: var(--you-blue);
  }
  .week-choice-label {
    font-size: 0.7rem;
    font-weight: 600;
  }
  .week-choice-dates {
    font-size: 0.85rem;
    font-weight: 750;
    color: var(--text-accent);
  }
  .week-choice[aria-pressed='true'] .week-choice-dates {
    color: var(--you-blue);
  }
  .week-hint {
    font-size: 0.75rem;
    opacity: 0.7;
    margin: 10px 0 20px;
  }
  button {
    min-height: 44px;
    min-width: 44px;
    padding: 0 14px;
    border-radius: var(--radius-control);
    font-weight: 600;
    cursor: pointer;
  }
  button:hover {
    background: var(--you-blue-pale);
    color: var(--text-accent);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:focus-visible,
  summary:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 3px;
  }
  .coverage {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    font-size: 0.75rem;
    color: var(--text-accent);
  }
  .schedule-note {
    margin: 10px 0 20px;
    max-width: 80ch;
    line-height: 1.6;
  }
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 14px;
    margin-bottom: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 0.8rem;
  }
  .notice button {
    background: var(--surface);
    border-radius: var(--radius-control);
    font-weight: 600;
  }
  .week-summary {
    margin-bottom: 1rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 750;
    color: var(--text-heading);
  }
  .week-summary > span {
    color: var(--text-accent);
    font-size: 0.8rem;
  }
  .calendar-stage {
    overflow: hidden;
    padding: 8px;
    margin: -8px;
  }
  .week-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 10px;
  }
  .day {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-subtle);
    background: var(--surface);
    border-radius: var(--radius-panel);
    min-height: 320px;
    min-width: 0;
    overflow: hidden;
  }
  .day.today {
    border-color: var(--you-blue);
    box-shadow: 0 0 0 1px var(--you-blue);
  }
  .day-heading {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 76px;
    flex: none;
    padding: 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.75rem;
    color: var(--text-accent);
  }
  .day-heading-copy {
    min-width: 0;
  }
  .day-name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-weight: 800;
    color: var(--text-heading);
  }
  .day-number {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex: none;
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--text-heading);
    margin-left: auto;
    border-radius: 50%;
  }
  .today .day-number {
    background: var(--action);
    color: var(--action-content);
  }
  .today-label {
    padding: 2px 5px;
    border-radius: 5px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 0.6rem;
    font-weight: 700;
  }
  .day-episodes {
    padding: 6px;
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 0;
  }
  .day-entry + .day-entry {
    border-top: 1px solid var(--border-subtle);
    margin-top: 4px;
    padding-top: 4px;
  }
  .day-entry {
    flex: none;
  }
  .day-entry.preview-hidden {
    display: none;
  }
  .day-summary {
    margin-top: 4px;
    font-size: 0.65rem;
    color: var(--text-accent);
  }
  .empty-day {
    font-size: 0.75rem;
    opacity: 0.6;
    padding: 24px 8px;
    text-align: center;
    margin: auto 0;
  }
  .view-all {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    color: var(--text-accent);
    font-size: 0.75rem;
    background: var(--you-blue-pale);
    margin: 0 8px 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    flex-shrink: 0;
  }
  .view-all-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
  }
  .view-all-copy small {
    font-size: 0.65rem;
    font-weight: 500;
  }
  .view-all svg {
    flex: none;
  }
  .scroll-day {
    display: none;
    flex: none;
    width: 100%;
    border-top: 1px solid var(--border-subtle);
    border-radius: 0;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 0.7rem;
    padding: 8px;
  }
  .scroll-top {
    display: none;
  }
  .day:global([data-at-end]) .scroll-more {
    display: none;
  }
  .day:global([data-at-end]) .scroll-top {
    display: inline;
  }
  .empty-week {
    padding: 20px;
    text-align: center;
    color: var(--text-accent);
  }
  .unscheduled {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    padding: 16px;
    margin-top: 20px;
    background: var(--surface);
  }
  summary {
    display: flex;
    align-items: center;
    gap: 12px;
    list-style: none;
    cursor: pointer;
    font-weight: 700;
    font-size: 0.85rem;
    padding: 8px 0;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .unscheduled-icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
    border-radius: 12px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
  }
  .unscheduled-heading {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .unscheduled-heading strong {
    color: var(--text-heading);
  }
  .unscheduled-heading > span {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--text-accent);
  }
  .unscheduled-count {
    display: inline-block;
    margin-left: 6px;
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 0.7rem;
  }
  .unscheduled-chevron {
    flex: none;
    color: var(--text-accent);
  }
  .unscheduled[open] .unscheduled-chevron {
    transform: rotate(180deg);
  }
  .unscheduled > p {
    margin: 10px 0 16px;
    line-height: 1.6;
  }
  .unscheduled ul {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    gap: 10px;
    margin-top: 12px;
    list-style: none;
  }
  .unscheduled li {
    min-width: 0;
  }
  /* Keep touch layouts free of nested scrolling; desktop columns show the full day. */
  @media (hover: hover) and (pointer: fine) {
    @container schedule (min-width: 601px) {
      .day-episodes {
        height: min(25rem, 50dvh);
        min-height: 0;
        flex: none;
        overflow-y: hidden;
        scrollbar-gutter: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--text-accent) var(--you-blue-pale);
      }
      .day:global([data-scrollable]) .day-episodes {
        overflow-y: auto;
        scrollbar-gutter: stable;
      }
      .day-entry.preview-hidden {
        display: block;
      }
      .view-all {
        display: none;
      }
      .day:global([data-scrollable]) .scroll-day {
        display: block;
      }
    }
  }
  @container schedule (max-width: 1100px) {
    .week-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .day {
      min-height: 180px;
    }
  }
  @container schedule (max-width: 600px) {
    .week-picker {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .week-picker::before {
      width: calc((100% - 10px - 4px) / 2);
      height: calc((100% - 10px - 4px) / 2);
      transform: translate(
        calc(var(--active-column) * (100% + 4px)),
        calc(var(--active-row) * (100% + 4px))
      );
    }
    .week-grid {
      grid-template-columns: 1fr;
    }
    .day {
      min-height: 0;
    }
    .calendar-heading {
      margin-bottom: 1.25rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .week-picker::before,
    .week-choice {
      transition: none;
    }
  }
</style>
