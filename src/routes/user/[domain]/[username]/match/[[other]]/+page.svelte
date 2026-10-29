<script lang="ts">
  import { page } from '$app/state';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import ShareButton from '#lib/components/ShareButton.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import YouSvg from '#lib/images/minimalist_you.svg';
  import { describeMatch, finalThought, matchComment, voiceFor } from '#lib/match-words.js';
  import {
    compareTastes,
    favoriteAnime,
    loadTasteProfile,
    matchPath,
    MIN_BOTH_SCORED,
    parseUserName,
    type TasteProfileState,
  } from '#lib/match.js';
  import { describeScore, formatScore } from '#lib/score.js';
  import type { ScoredByBoth, TasteProfile } from '#lib/types/match.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const pair = $derived(data.other !== null);
  // Read again only when the names change, not when other page data does, as after a settings change
  const name = $derived(data.name);
  const other = $derived(data.other);

  let first = $state<TasteProfileState>({ status: 'loading' });
  let second = $state<TasteProfileState>({ status: 'loading' });
  let attempt = $state(0);
  $effect(() => {
    const [a, b] = [name, other];
    void attempt;
    let active = true;
    first = { status: 'loading' };
    second = { status: 'loading' };
    loadTasteProfile(a).then((state) => {
      if (active) first = state;
    });
    if (b) {
      loadTasteProfile(b).then((state) => {
        if (active) second = state;
      });
    }
    return () => {
      active = false;
    };
  });

  const states = $derived(pair ? [first, second] : [first]);
  const missing = $derived(
    [data.name, data.other ?? ''].filter((_, index) => states[index]?.status === 'missing')
  );
  const retryAt = $derived(
    Math.max(0, ...states.map((state) => (state.status === 'busy' ? state.retryAt : 0)))
  );
  const failed = $derived(states.some((state) => state.status === 'failed'));
  const settled = $derived(
    states.every((state) => state.status === 'ready' || state.status === 'missing')
  );

  // Counts down to when "Try again" can be used, while AniList is busy, and stops there
  let now = $state(Date.now());
  $effect(() => {
    if (retryAt <= Date.now()) return;
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
      if (now >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  });

  const profileA = $derived(first.status === 'ready' ? first.profile : null);
  const profileB = $derived(pair && second.status === 'ready' ? second.profile : null);
  const showMature = $derived(data.preferences.showMature);
  // Two names of one AniList account, which their spelling alone couldn't show: never compared
  const sameUser = $derived(profileA !== null && profileA.id === profileB?.id);
  const match = $derived(
    profileA && profileB && !sameUser ? compareTastes(profileA, profileB, { showMature }) : null
  );
  // As AniList spells them once read, as typed until then
  const nameA = $derived(profileA?.name ?? data.name);
  const nameB = $derived(profileB?.name ?? data.other ?? '');

  const voice = $derived(voiceFor(data.user?.name));
  const { isViewer, who, Who, whose, Whose } = $derived(voice);
  const ownInvite = $derived(isViewer(data.name));
  const viewerCompared = $derived(isViewer(nameA) || isViewer(nameB));
  // One list of words and titles, its sentences a space apart
  const thought = $derived(
    match && profileA && profileB
      ? finalThought(match, profileA, profileB, voice).flatMap((sentence, index) =>
          index ? [{ text: ' ' }, ...sentence] : sentence
        )
      : []
  );

  // The viewer's picks first, or those for whoever was compared with the list's owner
  const pickSections = $derived.by(() => {
    if (!match || !profileA || !profileB) return [];
    const forA = { to: profileA, from: profileB, picks: match.picksForA };
    const forB = { to: profileB, from: profileA, picks: match.picksForB };
    return (isViewer(profileA.name) ? [forA, forB] : [forB, forA]).filter(
      ({ picks }) => picks.length
    );
  });
  const favorites = $derived(profileA ? favoriteAnime(profileA, { showMature }).slice(0, 6) : []);

  const share = $derived(
    pair
      ? {
          url: `${page.url.origin}${matchPath(nameA, nameB)}`,
          title: `${nameA} × ${nameB}: ${viewerCompared ? 'our' : 'an'} anime taste match on Yousoro`,
          subject: 'this match',
        }
      : {
          url: `${page.url.origin}${matchPath(nameA)}`,
          title: `Compare your anime taste with ${ownInvite ? 'mine' : nameA} on Yousoro`,
          subject: `${ownInvite ? 'your' : `${nameA}'s`} taste match link`,
        }
  );

  /*
   * What's wrong with the name in the form: as the load found it, or caught here before sending it,
   * so nobody waits on a page load to learn they typed their own name
   */
  let formError = $derived<'invalid' | 'same' | null>(
    data.invalidName !== null ? 'invalid' : data.same ? 'same' : null
  );
  // Bound rather than set from the load, so showing an error never resets what was typed
  let typed = $derived(data.invalidName ?? '');
  let nameInput = $state<HTMLInputElement>();
  function checkName(event: SubmitEvent) {
    const name = parseUserName(typed);
    formError = !name ? 'invalid' : name.toLowerCase() === data.name.toLowerCase() ? 'same' : null;
    if (!formError) return;
    event.preventDefault();
    // Read with the error it now describes
    nameInput?.focus();
  }

  const listUrl = (name: string) => `/user/anilist/${encodeURIComponent(name)}`;
  const count = (value: number) => value.toLocaleString();
</script>

{#snippet scoredRows(entries: ScoredByBoth[], a: TasteProfile, b: TasteProfile)}
  <ul class="anime-rows">
    {#each entries as { anime, a: scoreA, b: scoreB } (anime.id)}
      <li>
        <a
          class="anime-row"
          href={`https://anilist.co/anime/${anime.id}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${anime.title}: ${who(a.name)} ${describeScore(scoreA, a.scoreFormat)}, ${who(b.name)} ${describeScore(scoreB, b.scoreFormat)}, opens in a new tab`}
        >
          <span class="row-cover">
            <SharedAnimePoster
              {anime}
              compact
              decorative
              blurMature={data.preferences.blurMature}
            />
          </span>
          <span class="row-text">
            <span class="row-title">{anime.title}</span>
            <span class="row-scores">
              <span
                >{Who(a.name)}
                <strong>{formatScore(scoreA, a.scoreFormat)}</strong></span
              >
              <span
                >{Who(b.name)}
                <strong>{formatScore(scoreB, b.scoreFormat)}</strong></span
              >
            </span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet compareForm()}
  <form class="compare-form" method="get" action={matchPath(data.name)} onsubmit={checkName}>
    <label for="compare-name">
      {pair
        ? `Compare ${nameA} with someone else`
        : ownInvite
          ? 'Compare with anyone'
          : 'Your AniList name'}
    </label>
    <div class="compare-row">
      <input
        bind:this={nameInput}
        id="compare-name"
        class="tw:input"
        name="with"
        required
        bind:value={typed}
        placeholder="AniList name or profile link"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        aria-invalid={formError ? 'true' : undefined}
        aria-describedby={formError ? 'compare-error' : undefined}
        oninput={() => (formError = null)}
      />
      <button class="tw:btn tw:btn-primary">Compare</button>
    </div>
    {#if formError}
      <p id="compare-error" class="form-error">
        {#if formError === 'invalid'}
          That doesn't look like an AniList name. Try the name shown on their profile.
        {:else if ownInvite}
          That's you! Enter a friend's name to compare.
        {:else if pair}
          That's {nameA}. Enter someone else's name to compare.
        {:else}
          That's {nameA}. Enter your own AniList name to compare with them.
        {/if}
      </p>
    {/if}
  </form>
{/snippet}

<AutoReadRetry
  retryKey={`match:${data.name}:${data.other ?? ''}`}
  {retryAt}
  recovered={settled}
  onretry={() => attempt++}
/>

<section class="match-page">
  <header class="match-header">
    <div class="avatars" class:pair aria-hidden="true">
      <FriendAvatar
        id={profileA?.id ?? 0}
        name={nameA}
        avatarUrl={profileA?.avatarUrl ?? null}
        size={56}
      />
      {#if pair}
        <FriendAvatar
          id={profileB?.id ?? 0}
          name={nameB}
          avatarUrl={profileB?.avatarUrl ?? null}
          size={56}
        />
      {/if}
    </div>
    <div class="heading-copy">
      <div class="title-row">
        <h1>
          {#if pair}
            {nameA} <span aria-hidden="true">×</span><span class="tw:sr-only">and</span>
            {nameB}<span class="tw:sr-only">: anime taste match</span>
          {:else if ownInvite}
            Compare your anime taste
          {:else}
            Compare your anime taste with {nameA}
          {/if}
        </h1>
        <ShareButton url={share.url} title={share.title} subject={share.subject} />
      </div>
      <p class="summary">
        {#if pair}
          Anime taste match ·
          <a href={listUrl(nameA)}>{Whose(nameA)} list</a> ·
          <a href={listUrl(nameB)}>{Whose(nameB)} list</a>
        {:else if ownInvite}
          Share this page so friends can see how their scores match yours.
        {:else}
          See the anime you both loved, where you disagree, and what to watch next.
        {/if}
      </p>
    </div>
  </header>

  {#if missing.length}
    <!-- A signed-in viewer exists on AniList, so their own list is missing because it's private -->
    {@const others = missing.filter((name) => !isViewer(name))}
    <div class="notice" role="alert">
      {#if others.length < missing.length}
        <h2>Your AniList list isn't public</h2>
        <p>
          Make it public in your AniList settings to compare it{others.length
            ? `, and check the spelling of ${others[0]}, whose list can't be found either`
            : ''}.
        </p>
      {:else}
        <h2>
          {others.length === 2
            ? `There are no public AniList lists for ${others[0]} or ${others[1]}`
            : `There's no public AniList list for ${others[0]}`}
        </h2>
        <p>Check the spelling, or ask them to make their list public on AniList.</p>
      {/if}
    </div>
  {:else if failed || (retryAt && !settled)}
    <div class="notice" role="status">
      <h2>{failed ? "AniList isn't answering right now" : 'AniList is busy right now'}</h2>
      <p>Please try again in a moment.</p>
      <button type="button" class="tw:btn" disabled={now < retryAt} onclick={() => attempt++}>
        {now < retryAt ? `Try again in ${Math.ceil((retryAt - now) / 1000)}s` : 'Try again'}
      </button>
    </div>
  {:else if sameUser}
    <div class="notice" role="alert">
      <h2>That's {nameA} twice</h2>
      <p>Both names belong to the same AniList account. Compare {nameA} with someone else below.</p>
    </div>
  {:else if pair && !match}
    <div class="result loading" aria-hidden="true"><span></span><span></span></div>
    <p class="tw:sr-only" role="status">Comparing lists…</p>
  {/if}

  {#if match && profileA && profileB}
    <div class="result">
      {#if match.percent !== null}
        <p class="headline">
          <strong>{match.percent}%</strong>
          <span>{describeMatch(match.percent)}</span>
        </p>
        <p class="comment">{matchComment(match.percent, profileA, profileB, viewerCompared)}</p>
        <p class="basis">
          From the {count(match.bothScored)} anime {viewerCompared
            ? "you've"
            : `${nameA} and ${nameB} have`} both scored · {count(match.inCommon)} in common
        </p>
      {:else}
        <p class="headline">
          <strong>{count(match.inCommon)}</strong>
          <span>anime in common</span>
        </p>
        <p class="basis">
          A match needs at least {MIN_BOTH_SCORED} anime scored by both, {match.bothScored
            ? `and there ${match.bothScored === 1 ? 'is' : 'are'} only ${match.bothScored} so far`
            : 'and there are none yet'}. Scores on AniList count right away.
        </p>
      {/if}
    </div>

    {#if match.bothLoved.length}
      <section class="match-section" aria-labelledby="both-loved">
        <h2 id="both-loved">Both loved</h2>
        {@render scoredRows(match.bothLoved, profileA, profileB)}
      </section>
    {/if}

    {#if match.disagreements.length}
      <section class="match-section" aria-labelledby="disagreements">
        <h2 id="disagreements">{viewerCompared ? 'Where you disagree' : 'Where they disagree'}</h2>
        {@render scoredRows(match.disagreements, profileA, profileB)}
      </section>
    {/if}

    {#each pickSections as { to, from, picks }, index (to.id)}
      <section class="match-section" aria-labelledby={`picks-${index}`}>
        <h2 id={`picks-${index}`}>
          For {who(to.name)}, from {whose(from.name)} favorites
        </h2>
        <ul class="poster-grid">
          {#each picks as { anime, planned } (anime.id)}
            <li>
              <SharedAnimePoster
                {anime}
                blurMature={data.preferences.blurMature}
                detail={{
                  badge: `${planned ? 'Planned · ' : ''}${formatScore(anime.score, from.scoreFormat)}`,
                  label: `${who(from.name)} scored it ${describeScore(anime.score, from.scoreFormat)}${planned ? `, on ${whose(to.name)} plan list` : ''}`,
                }}
              />
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    {#if thought.length}
      <!-- You Watanabe, whose salute names the site, has the last word -->
      <section class="final-thought" aria-labelledby="final-thought">
        <!-- The drawing's own size, so its room is kept while it loads -->
        <img class="final-you" src={YouSvg} alt="" width="1010" height="700" />
        <div class="final-copy">
          <h2 id="final-thought">Final thought</h2>
          <p>
            {#each thought as part, index (index)}{#if part.title}<cite>{part.text}</cite
                >{:else}{part.text}{/if}{/each}
          </p>
          <ShareButton url={share.url} title={share.title} subject={share.subject} />
        </div>
      </section>
    {/if}
  {/if}

  {@render compareForm()}

  {#if !pair && favorites.length && profileA}
    <section class="match-section" aria-labelledby="favorites">
      <h2 id="favorites">{Whose(nameA)} favorites</h2>
      <ul class="poster-grid">
        {#each favorites as anime (anime.id)}
          <li>
            <SharedAnimePoster
              {anime}
              blurMature={data.preferences.blurMature}
              detail={{
                badge: formatScore(anime.score, profileA.scoreFormat),
                label: `${who(nameA)} scored it ${describeScore(anime.score, profileA.scoreFormat)}`,
              }}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</section>

<style>
  .match-page {
    display: flex;
    flex-direction: column;
    gap: 28px;
    width: 100%;
    max-width: 56rem;
    margin: 24px auto 0;
  }

  .match-header {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  /* Two avatars overlap a little, as a pair */
  .avatars {
    display: flex;
    flex: none;
  }

  /* The page's own colour rings the second, separating it from the first */
  .avatars.pair > :global(:last-child) {
    margin-left: -12px;
    box-shadow:
      0 0 0 3px var(--surface-muted),
      inset 0 0 0 1px var(--border-subtle);
  }

  .heading-copy {
    min-width: 0;
  }

  /* A long name wraps the share button onto its own line rather than squeezing either */
  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 8px;
  }

  h1 {
    min-width: 0;
    color: var(--text-heading);
    font-size: 1.5rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.25;
    /* AniList names are one word of up to 20 letters, wider than a phone has room for */
    overflow-wrap: anywhere;
  }

  .summary {
    margin-top: 4px;
    color: var(--text-accent);
    font-size: 0.875rem;
  }

  .summary a:hover,
  .summary a:focus-visible {
    text-decoration: underline;
  }

  .result,
  .notice {
    padding: 24px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .headline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
    color: var(--text-heading);
  }

  .headline strong {
    font-size: clamp(3rem, 12vw, 4.5rem);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.04em;
    line-height: 1;
  }

  .headline span {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .comment {
    margin-top: 12px;
    color: var(--text-heading);
    font-size: 1rem;
    line-height: 1.45;
  }

  .basis {
    margin-top: 8px;
    color: var(--text-accent);
    font-size: 0.875rem;
  }

  .final-thought {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 20px 24px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .final-you {
    flex: none;
    width: 128px;
    height: auto;
  }

  .final-copy {
    min-width: 0;
  }

  .final-copy h2 {
    color: var(--text-heading);
    font-size: 1.0625rem;
    font-weight: 600;
  }

  .final-copy p {
    margin: 6px 0 10px;
    color: var(--text-heading);
    font-size: 0.9375rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  cite {
    font-style: normal;
    font-weight: 600;
  }

  .loading {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .loading span {
    display: block;
    width: 9rem;
    height: 3.5rem;
    border-radius: var(--radius-control);
    background: var(--surface-muted);
  }

  .loading span + span {
    width: min(100%, 22rem);
    height: 1rem;
  }

  .notice h2 {
    color: var(--text-heading);
    font-size: 1.0625rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .notice p {
    margin-top: 6px;
    color: var(--text-accent);
    font-size: 0.875rem;
  }

  .notice button {
    min-height: 44px;
    margin-top: 16px;
  }

  .match-section h2 {
    margin-bottom: 12px;
    color: var(--text-heading);
    font-size: 1.0625rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .anime-rows {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
    gap: 10px;
  }

  .anime-row {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 100%;
    padding: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .anime-row:hover {
    border-color: var(--you-blue);
    background: var(--you-blue-pale);
  }

  .row-cover {
    flex: none;
    width: 44px;
  }

  .row-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .row-title {
    color: var(--text-heading);
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .row-scores {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    color: var(--text-accent);
    font-size: 0.8125rem;
  }

  .row-scores strong {
    color: var(--text-heading);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .poster-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 16px;
  }

  .compare-form {
    padding: 20px 24px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface-muted);
  }

  .compare-form label {
    display: block;
    margin-bottom: 8px;
    color: var(--text-heading);
    font-size: 0.9375rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .compare-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .compare-row input {
    flex: 1 1 14rem;
    min-width: 0;
    min-height: 44px;
  }

  .compare-row button {
    flex: none;
    min-height: 44px;
    padding-inline: 20px;
  }

  .form-error {
    margin-top: 8px;
    color: var(--text-heading);
    font-size: 0.8125rem;
  }

  @media (max-width: 480px) {
    .match-header {
      align-items: flex-start;
    }

    .result,
    .notice,
    .compare-form,
    .final-thought {
      padding: 18px 16px;
    }

    /* You sits above her thought on a phone, leaving the text the full width */
    .final-thought {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }

    .final-you {
      width: 104px;
    }

    .compare-row button {
      flex: 1 1 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .anime-row {
      transition: none;
    }
  }
</style>
