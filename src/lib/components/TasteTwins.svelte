<script lang="ts">
  import { page } from '$app/state';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import ShareButton from '#lib/components/ShareButton.svelte';
  import { describeMatch } from '#lib/match-words.js';
  import { matchPath, MIN_BOTH_SCORED } from '#lib/match.js';
  import { compareWithFriends, rankTwins, type TwinResult } from '#lib/taste-twins.js';

  type Props = {
    /** Whose friends these are */
    owner: string;
    friends: { id: number; name: string; avatarUrl: string | null }[];
    /** The viewer's own friends, spoken of as "you" */
    own: boolean;
  };

  let { owner, friends, own }: Props = $props();

  /*
   * Each friend's list is a read of its own, so they're compared only when asked, and a round at a
   * time: a long following list would otherwise keep AniList busy for minutes
   */
  const ROUND = 24;
  // Ranks shown before "Show all"
  const SHOWN = 5;

  let results = $state<TwinResult[]>([]);
  let status = $state<'idle' | 'running' | 'busy' | 'failed' | 'private' | 'unscored' | 'done'>(
    'idle'
  );
  // How many anime the owner has scored, when too few to compare
  let ownScored = $state(0);
  let retryAt = $state(0);
  // How many friends this round compares, counting those compared before it
  let wanted = $state(0);
  let showAll = $state(false);

  // Stops reading when the page goes, or shows someone else's friends
  let active = true;
  $effect(() => {
    active = true;
    return () => {
      active = false;
    };
  });

  // A retry by hand and an automatic one never overlap, which would compare a friend twice
  async function run() {
    if (status === 'running') return;
    status = 'running';
    const done = new Set(results.map((result) => result.id));
    const todo = friends.filter((friend) => !done.has(friend.id)).slice(0, wanted - done.size);
    const outcome = await compareWithFriends(owner, todo, (result) => results.push(result), {
      active: () => active,
    });
    if (!outcome) return;
    retryAt = outcome.status === 'busy' ? outcome.retryAt : 0;
    ownScored = outcome.status === 'unscored' ? outcome.scored : 0;
    status = outcome.status;
  }

  // Counts down to when "Try again" can be used, once automatic retries have paused
  let now = $state(Date.now());
  $effect(() => {
    if (status !== 'busy' || retryAt <= Date.now()) return;
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
      if (now >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  });

  function compare() {
    wanted = Math.min(friends.length, results.length + ROUND);
    void run();
  }

  const ranked = $derived(rankTwins(results));
  const shown = $derived(showAll ? ranked : ranked.slice(0, SHOWN));
  const top = $derived(ranked.at(0));
  const hidden = $derived(results.filter((result) => result.private).length);
  const tooFew = $derived(results.length - ranked.length - hidden);
  const remaining = $derived(friends.length - results.length);

  const share = $derived(
    top
      ? {
          url: `${page.url.origin}${matchPath(owner, top.name)}`,
          title: `${own ? 'My' : `${owner}'s`} anime taste twin is ${top.name} (${top.percent}% match) on Yousoro`,
        }
      : null
  );
  const count = (value: number) => value.toLocaleString();
  const people = (value: number) => `${count(value)} ${value === 1 ? 'friend' : 'friends'}`;
</script>

<section class="twins" aria-labelledby="twins-heading">
  <div class="twins-head">
    <div class="twins-copy">
      <h2 id="twins-heading">Taste twins</h2>
      <p>
        See whose anime taste is closest to {own ? 'yours' : `${owner}'s`}, from everyone's AniList
        scores.
      </p>
    </div>
    {#if status === 'idle'}
      <button type="button" class="tw:btn tw:btn-primary" onclick={compare}>Compare tastes</button>
    {/if}
  </div>

  {#if status === 'private'}
    <p class="twins-note" role="alert">
      {own
        ? 'Your AniList list isn’t public, so there’s nothing to compare yet. Make it public in your AniList settings.'
        : `${owner}'s AniList list isn't public, so there's nothing to compare.`}
    </p>
  {:else if status === 'unscored'}
    <p class="twins-note" role="status">
      A match needs at least {MIN_BOTH_SCORED} anime scored by both, and {own
        ? 'you have'
        : `${owner} has`}
      scored {ownScored ? `only ${count(ownScored)}` : 'none'} on AniList so far. Scores count right away.
    </p>
  {:else if status === 'failed'}
    <p class="twins-note" role="status">
      AniList isn't answering right now.
      <button type="button" class="tw:btn tw:btn-sm" onclick={run}>Try again</button>
    </p>
  {:else if status === 'running' || status === 'busy'}
    <p class="twins-note" role="status">
      Compared {count(results.length)} of {people(wanted)}…
      {#if status === 'busy'}
        <button type="button" class="tw:btn tw:btn-sm" disabled={now < retryAt} onclick={run}
          >Try again</button
        >
      {/if}
    </p>
  {/if}
  <AutoReadRetry
    retryKey={`twins:${owner}`}
    retryAt={status === 'busy' ? retryAt : 0}
    recovered={status === 'done'}
    onretry={run}
  />

  {#if top && share}
    <div class="twin-top">
      <FriendAvatar id={top.id} name={top.name} avatarUrl={top.avatarUrl} size={56} />
      <div class="twin-top-copy">
        <p class="eyebrow">{status === 'done' ? 'Closest match' : 'Closest so far'}</p>
        <p class="twin-name">
          <a href={matchPath(owner, top.name)}>{top.name}</a>
          <strong>{top.percent}%</strong>
          <span>{describeMatch(top.percent)}</span>
        </p>
        <ShareButton url={share.url} title={share.title} subject="this taste twin" />
      </div>
    </div>
  {/if}

  {#if ranked.length > 1}
    <ol class="twin-list">
      {#each shown as twin, index (twin.id)}
        <li>
          <a href={matchPath(owner, twin.name)}>
            <span class="rank" aria-hidden="true">{index + 1}</span>
            <FriendAvatar id={twin.id} name={twin.name} avatarUrl={twin.avatarUrl} size={32} />
            <span class="twin-row-name">{twin.name}</span>
            <span class="twin-row-match"
              ><strong>{twin.percent}%</strong>
              <span>{describeMatch(twin.percent)}</span></span
            >
          </a>
        </li>
      {/each}
    </ol>
    {#if ranked.length > SHOWN}
      <button type="button" class="more" onclick={() => (showAll = !showAll)}>
        {showAll ? 'Show fewer' : `Show all ${count(ranked.length)}`}
      </button>
    {/if}
  {/if}

  {#if status === 'done' || status === 'busy'}
    {#if tooFew || hidden}
      <p class="twins-note">
        {[
          tooFew
            ? `${people(tooFew)} ${tooFew === 1 ? 'has' : 'have'} too few anime scored in common to compare`
            : '',
          hidden ? `${people(hidden)} ${hidden === 1 ? 'keeps' : 'keep'} their list private` : '',
        ]
          .filter(Boolean)
          .join(' · ')}.
      </p>
    {/if}
  {/if}

  {#if status === 'done' && remaining > 0}
    <button type="button" class="tw:btn next-round" onclick={compare}>
      Compare {people(Math.min(ROUND, remaining))} more
    </button>
  {/if}
</section>

<style>
  .twins {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    margin-bottom: 24px;
    padding: 20px 24px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .twins-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    width: 100%;
  }

  .twins-copy {
    flex: 1 1 18rem;
    min-width: 0;
  }

  h2 {
    color: var(--text-heading);
    font-size: 1.0625rem;
    font-weight: 600;
  }

  .twins-copy p,
  .twins-note {
    margin-top: 4px;
    color: var(--text-accent);
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }

  .twins-head button,
  .next-round {
    min-height: 44px;
  }

  .twin-top {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    padding-top: 14px;
    border-top: 1px solid var(--border-subtle);
  }

  .twin-top-copy {
    min-width: 0;
  }

  .eyebrow {
    color: var(--text-accent);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .twin-name {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    color: var(--text-heading);
  }

  .twin-name a {
    font-size: 1.25rem;
    font-weight: 650;
    overflow-wrap: anywhere;
  }

  .twin-name a:hover {
    text-decoration: underline;
  }

  .twin-name strong {
    font-size: 1.25rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .twin-name span {
    color: var(--text-accent);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .twin-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
    gap: 8px;
    width: 100%;
  }

  .twin-list a {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 6px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .twin-list a:hover {
    border-color: var(--you-blue);
    background: var(--you-blue-pale);
  }

  .rank {
    width: 1.25rem;
    flex: none;
    color: var(--text-accent);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .twin-row-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-heading);
    font-size: 0.875rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .twin-row-match {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.2;
  }

  .twin-row-match strong {
    color: var(--text-heading);
    font-size: 0.9375rem;
    font-variant-numeric: tabular-nums;
  }

  .twin-row-match span {
    color: var(--text-accent);
    font-size: 0.6875rem;
  }

  .more {
    min-height: 44px;
    color: var(--text-accent);
    font-size: 0.8125rem;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  @media (max-width: 480px) {
    .twins {
      padding: 18px 16px;
    }

    .twins-head button {
      flex: 1 1 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .twin-list a {
      transition: none;
    }
  }
</style>
