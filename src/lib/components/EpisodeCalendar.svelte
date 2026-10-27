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
  import ScheduleDayDialog from '#lib/components/ScheduleDayDialog.svelte';
  import ScheduledEpisodeLink from '#lib/components/ScheduledEpisodeLink.svelte';
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
  const days = $derived(week ? calendarWeek(episodes, week, clock.now) : []);
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
        retryUntil = getScheduleRetryAt();
        timerNow = Date.now();
      })
      .catch((err) => {
        if (obsolete) return;
        unavailable = true;
        retryUntil = err instanceof ScheduleUnavailable ? err.retryAt : 0;
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
</script>

<section class="calendar" aria-label="Upcoming episodes">
  <div class="calendar-heading">
    <div>
      <p class="eyebrow">Coming up</p>
      <h1>Episode calendar</h1>
      <p class="description">Airing times from AniList · {timezone || 'Your local time zone'}</p>
    </div>
  </div>
  {#if start && week}
    <div class="coverage">
      <span class="coverage-badge">4-week schedule</span>
      <p>
        {dateLabel(start)} – {dateLabel(addCalendarDays(start, 27))}, {addCalendarDays(
          start,
          27
        ).getFullYear()} · Watching &amp; Rewatching
      </p>
    </div>
    <p class="schedule-note">
      Confirmed AniList air dates only; unannounced episodes are not estimated. Times may change and
      differ from streaming availability.
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
          <span class="week-choice-label"
            >{choice.label}<svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg
            ></span
          >
          <span class="week-choice-dates">{choice.range}</span>
        </button>
      {/each}
    </div>
    <p class="week-hint" id="{heading}-week-hint">
      Select a date range · This week and the next three weeks are available.
    </p>
    <div class="week-summary" aria-live="polite" aria-atomic="true">
      <h2>{dateLabel(week)} – {dateLabel(addCalendarDays(week, 6))}</h2>
      <span
        >Week {weekIndex + 1} of 4 · {total}{incomplete ? '+' : ''} upcoming {total === 1
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
              class:today
              aria-label={day.date.toLocaleDateString(undefined, { dateStyle: 'full' })}
            >
              <div class="day-heading">
                <span>{day.date.toLocaleDateString(undefined, { weekday: 'short' })}</span><span
                  class="day-number"
                  aria-current={today ? 'date' : undefined}>{day.date.getDate()}</span
                >{#if today}<span class="today-label">Today</span>{/if}
              </div>
              <div class="day-episodes">
                {#each day.episodes.slice(0, 3) as entry (`${entry.anime.id}:${entry.episode}`)}<ScheduledEpisodeLink
                    {entry}
                    {blurMature}
                  />{:else}<p class="empty-day">
                    {incomplete ? 'No known episodes' : 'No confirmed episodes'}
                  </p>{/each}
                {#if day.episodes.length > 3}<button
                    class="view-all"
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`View all ${day.episodes.length} episodes for ${day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                    onclick={() => (selectedDate = day.date)}
                    >View all · {day.episodes.length}</button
                  >{/if}
              </div>
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
    <p class="cache-note">
      Schedule data stays fresh for one hour. If AniList is unavailable, saved air dates can be
      shown for up to 24 hours with a warning. Reload the page to check for updates.
    </p>
    {#if !incomplete && unscheduled.length}
      <details class="unscheduled">
        <summary>No confirmed air date in these four weeks · {unscheduled.length} anime</summary>
        <p>These anime may be finished, on break, or awaiting an announced air date.</p>
        <ul>
          {#each unscheduled as entry (entry.id)}<li>
              <a
                href={`https://anilist.co/anime/${entry.id}`}
                target="_blank"
                rel="noopener noreferrer"
                >{entry.title}<span class="tw:sr-only">, opens in a new tab</span></a
              >
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

<style>
  .calendar {
    container: schedule / inline-size;
    width: 100%;
    max-width: 1500px;
    margin: 0 auto;
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
  .eyebrow {
    color: var(--text-accent);
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.13em;
  }
  h1 {
    color: var(--text-heading);
    font-size: clamp(1.6rem, 3vw, 2.2rem);
    font-weight: 800;
    letter-spacing: -0.04em;
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
    border-radius: 20px;
    background: light-dark(rgb(255 255 255 / 0.65), rgb(5 21 38 / 0.4));
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06);
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
    border-radius: 15px;
    background: linear-gradient(135deg, #1c78b0, #124a7a);
    box-shadow:
      0 4px 12px -5px rgb(15 61 110 / 0.55),
      inset 0 1px 0 rgb(255 255 255 / 0.2);
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
    border-radius: 15px;
    background: transparent;
    color: var(--text-heading);
    text-align: left;
    transition: color 160ms ease;
  }
  .week-choice[aria-pressed='true'] {
    background: transparent;
    color: #ffffff;
  }
  .week-choice-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .week-choice-label svg {
    width: 15px;
    height: 15px;
    flex: none;
    opacity: 0;
    color: var(--text-accent);
  }
  .week-choice[aria-pressed='true'] svg {
    opacity: 1;
    color: #bfeaff;
  }
  .week-choice-dates {
    font-size: 0.85rem;
    font-weight: 750;
    color: var(--text-accent);
  }
  .week-choice[aria-pressed='true'] .week-choice-dates {
    color: #ffffff;
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
    border-radius: 999px;
    font-weight: 700;
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
  a:focus-visible,
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
  .coverage-badge {
    padding: 5px 10px;
    border-radius: 999px;
    background: var(--you-blue-pale);
    font-weight: 750;
  }
  .schedule-note {
    margin: 10px 0 20px;
    max-width: 80ch;
    line-height: 1.6;
  }
  .cache-note {
    margin-top: 16px;
    font-size: 0.75rem;
    opacity: 0.65;
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
    border: 1px solid var(--border-subtle);
    background: var(--surface);
    border-radius: 18px;
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
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.75rem;
    color: var(--text-accent);
  }
  .day-number {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    font-size: 1rem;
    font-weight: 800;
    color: var(--text-heading);
    margin-left: auto;
    border-radius: 50%;
  }
  .today .day-number {
    background: var(--you-blue);
    color: #0f304f;
  }
  .today-label {
    font-size: 0.65rem;
    font-weight: 700;
  }
  .day-episodes {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .empty-day {
    font-size: 0.75rem;
    opacity: 0.6;
    padding: 10px 4px;
  }
  .view-all {
    color: var(--text-accent);
    font-size: 0.75rem;
    background: var(--you-blue-pale);
    margin-top: 4px;
  }
  .empty-week {
    padding: 20px;
    text-align: center;
    color: var(--text-accent);
  }
  .unscheduled {
    border-top: 1px solid var(--border-subtle);
    padding: 16px 0;
    margin-top: 20px;
  }
  summary {
    cursor: pointer;
    font-weight: 700;
    font-size: 0.85rem;
    padding: 8px 0;
  }
  .unscheduled ul {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
    list-style: none;
  }
  .unscheduled a {
    display: block;
    padding: 10px 14px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-accent);
    font-size: 0.8rem;
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
