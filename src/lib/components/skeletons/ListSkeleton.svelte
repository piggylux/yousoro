<script lang="ts">
  import Skeleton from '#lib/components/Skeleton.svelte';
  import ToolbarSkeleton from '#lib/components/skeletons/ToolbarSkeleton.svelte';
  import type { CardSize } from '#lib/types/preferences.js';

  let {
    calendar = false,
    cardSize = 'medium',
    own = false,
    anilist = true,
  }: {
    /** The episode calendar rather than the cards */
    calendar?: boolean;
    /** The viewer's card size, so the placeholder cards are the size the cards will be */
    cardSize?: CardSize;
    /** The viewer's own list, which can add anime and mark episodes watched */
    own?: boolean;
    /** An AniList list, which offers a taste match and watching together */
    anilist?: boolean;
  } = $props();

  // The profile's buttons, about as wide as theirs: adding anime, the season's picks, a taste
  // match, watching together and more
  const actions = $derived(
    [own && '7rem', '8.5rem', anilist && '7.5rem', anilist && '9rem', '2rem'].filter(
      (width): width is string => !!width
    )
  );
  // The section chips: behind, rewatching, caught up and other
  const CHIPS = ['6.75rem', '8.5rem', '8rem', '6.25rem'];
  // Enough to fill the first rows of a wide screen
  const CARDS = Array.from({ length: 12 }, (_, index) => index);
  const DAYS = Array.from({ length: 7 }, (_, index) => index);
</script>

<!-- The list's profile, then its filters and cards or its calendar, as they'll be laid out -->
<div class="list-skeleton" aria-hidden="true">
  <div class="profile-bar" class:calendar>
    <div class="profile">
      <span class="avatar"><Skeleton width="44px" height="44px" round /></span>
      <span class="name"><Skeleton width="9rem" height="1.25rem" /></span>
      <span class="actions">
        {#each actions as width, index (index)}
          <span class="action"><Skeleton {width} height="100%" /></span>
        {/each}
      </span>
    </div>
    <!-- How many episodes there are to catch up on -->
    {#if !calendar}
      <div class="backlog">
        <Skeleton width="2.25rem" height="1.75rem" />
        <span class="backlog-copy">
          <Skeleton width="min(100%, 17rem)" height="1rem" />
          <Skeleton width="min(100%, 24rem)" height="0.85rem" />
        </span>
      </div>
    {/if}
  </div>

  {#if calendar}
    <!-- The calendar's heading, what it covers, the weeks to pick from and the week's days -->
    <div class="calendar">
      <div class="calendar-heading">
        <span class="line heading"><Skeleton width="13rem" height="1.75rem" /></span>
        <span class="line description"><Skeleton width="17rem" height="0.8rem" /></span>
      </div>
      <span class="line coverage"><Skeleton width="min(100%, 18rem)" /></span>
      <span class="line note"><Skeleton width="min(100%, 25rem)" height="0.8rem" /></span>
      <span class="weeks"><Skeleton height="100%" /></span>
      <span class="line hint"><Skeleton width="14rem" /></span>
      <span class="line week"><Skeleton width="9rem" height="1.05rem" /></span>
      <div class="days">
        {#each DAYS as index (index)}
          <span class="day"><Skeleton height="100%" /></span>
        {/each}
      </div>
    </div>
  {:else}
    <ToolbarSkeleton controls={CHIPS} />
    <div class="anime-grid" data-size={cardSize}>
      {#each CARDS as index (index)}
        <!-- A card's status, cover, two-line title, and progress with its +1 button -->
        <div class="card" class:own>
          <span class="status"><Skeleton width="45%" height="1.25rem" /></span>
          <Skeleton ratio="3 / 4" />
          <span class="title">
            <Skeleton width="85%" height="0.9rem" />
            <Skeleton width="55%" height="0.9rem" />
          </span>
          <span class="progress">
            <span class="bar"><Skeleton height="6px" /></span>
            <Skeleton width="2.5rem" />
            {#if own}<Skeleton width="42px" height="32px" />{/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .list-skeleton {
    width: 100%;
  }

  /* The profile, with the catch-up banner beside it, or under it where there's no room */
  .profile-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px 28px;
    margin-bottom: 24px;
  }
  .profile-bar.calendar {
    margin-bottom: 12px;
  }
  /* The avatar beside the name, with the buttons under it */
  .profile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 8px 12px;
    min-width: 0;
  }
  .avatar {
    grid-row: span 2;
  }
  /* As tall as the name beside its profile link and share button */
  .name {
    display: flex;
    align-items: center;
    min-height: 30px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .action {
    display: block;
    height: 2rem;
  }
  .backlog {
    display: flex;
    flex: 0 1 40rem;
    align-items: center;
    gap: 14px;
    max-width: 100%;
    min-height: 70px;
    padding: 12px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-box);
    background: var(--surface);
    box-sizing: border-box;
  }
  .backlog-copy {
    display: grid;
    flex: 1;
    gap: 8px;
    min-width: 0;
  }

  /* The card's own box: its padding, gaps and quiet edge */
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: var(--card-width);
    padding: 10px;
    border-radius: var(--radius-box);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border-subtle);
    box-sizing: border-box;
  }
  .status {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 1.75rem;
  }
  .title {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-height: 3rem;
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 28px;
  }
  .own .progress {
    min-height: 32px;
  }
  .bar {
    flex: 1;
  }

  /* Its own box, as the calendar is, so its heading's margin adds to the profile's */
  .calendar {
    display: flow-root;
  }
  /* The calendar's lines of text, each as tall as its line box */
  .line {
    display: flex;
    align-items: center;
  }
  .calendar-heading {
    margin: 16px 0 24px;
  }
  .heading {
    height: 42px;
    margin: 4px 0;
  }
  .description {
    height: 19px;
  }
  .coverage {
    height: 18px;
    margin-bottom: 10px;
  }
  .note {
    min-height: 20px;
    margin-bottom: 21px;
  }
  .weeks {
    display: block;
    height: 76px;
    margin-bottom: 10px;
  }
  .hint {
    height: 18px;
    margin-bottom: 20px;
  }
  .week {
    height: 25px;
    margin-bottom: 16px;
  }
  .days {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 10px;
  }
  .day {
    display: block;
    height: 420px;
  }

  @media (pointer: coarse) {
    .action {
      height: 44px;
    }
  }
  /* Two days side by side where seven don't fit, as the calendar shows them */
  @media (max-width: 1132px) {
    .days {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .day {
      height: 180px;
    }
    .day:nth-child(n + 5) {
      display: none;
    }
  }
  /* Where the calendar is narrow, the weeks to pick from are two by two, and its notes wrap */
  @media (max-width: 632px) {
    .note {
      min-height: 41px;
    }
    .weeks {
      height: 144px;
    }
    .week {
      height: 60px;
    }
    .day {
      height: 156px;
    }
  }
  @media (max-width: 480px) {
    .avatar {
      grid-row: auto;
    }
    .actions {
      grid-column: 1 / -1;
    }
    /* The banner's headline wraps on a phone, with its detail below */
    .backlog {
      align-items: flex-start;
      min-height: 122px;
      padding: 10px 14px;
    }
  }
</style>
