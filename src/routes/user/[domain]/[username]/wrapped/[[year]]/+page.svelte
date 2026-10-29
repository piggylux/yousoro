<script lang="ts">
  import { page } from '$app/state';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import ShareButton from '#lib/components/ShareButton.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import YouSvg from '#lib/images/minimalist_you.svg';
  import { joinNames, voiceFor } from '#lib/match-words.js';
  import { matchPath } from '#lib/match.js';
  import { describeScore, formatScore } from '#lib/score.js';
  import {
    FIRST_YEAR,
    loadAnimeYear,
    summarizeYear,
    wrappedPath,
    type AnimeYearState,
  } from '#lib/wrapped.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // Read again only when the name or year changes, not when other page data does
  const name = $derived(data.name);
  const year = $derived(data.year);

  let yearState = $state<AnimeYearState>({ status: 'loading' });
  let attempt = $state(0);
  $effect(() => {
    const [who, when] = [name, year];
    void attempt;
    let active = true;
    yearState = { status: 'loading' };
    loadAnimeYear(who, when).then((loaded) => {
      if (active) yearState = loaded;
    });
    return () => {
      active = false;
    };
  });

  const retryAt = $derived(yearState.status === 'busy' ? yearState.retryAt : 0);
  const animeYear = $derived(yearState.status === 'ready' ? yearState.year : null);
  const summary = $derived(
    animeYear ? summarizeYear(animeYear, { showMature: data.preferences.showMature }) : null
  );
  // As AniList spells it once read, as typed until then
  const shownName = $derived(animeYear?.name ?? data.name);
  const { isViewer, Who, whose, Whose } = $derived(voiceFor(data.user?.name));
  const own = $derived(isViewer(shownName));
  const inProgress = $derived(year === new Date().getFullYear());

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

  const share = $derived({
    url: `${page.url.origin}${wrappedPath(shownName, year)}`,
    title: `${own ? 'My' : `${shownName}'s`} ${year} in anime on Yousoro`,
    subject: `${own ? 'your' : `${shownName}'s`} year in anime`,
  });

  const scoreOf = (anime: { score: number }) =>
    animeYear ? formatScore(anime.score, animeYear.scoreFormat) : '';
  const scoreWords = (anime: { score: number }) =>
    animeYear ? describeScore(anime.score, animeYear.scoreFormat) : '';
  const listUrl = (who: string) => `/user/anilist/${encodeURIComponent(who)}`;
  const count = (value: number) => value.toLocaleString();
  const plural = (value: number, word: string) =>
    `${count(value)} ${word}${value === 1 ? '' : 's'}`;
</script>

<AutoReadRetry
  retryKey={`wrapped:${data.name}:${data.year}`}
  {retryAt}
  recovered={yearState.status === 'ready' || yearState.status === 'missing'}
  onretry={() => attempt++}
/>

<section class="wrapped-page">
  <header class="wrapped-header">
    <FriendAvatar
      id={animeYear?.id ?? 0}
      name={shownName}
      avatarUrl={animeYear?.avatarUrl ?? null}
      size={56}
    />
    <div class="heading-copy">
      <div class="title-row">
        <h1>{Whose(shownName)} {year} in anime</h1>
        <ShareButton url={share.url} title={share.title} subject={share.subject} />
      </div>
      <p class="summary">
        {inProgress ? 'So far this year, from' : 'From'} the anime {own ? 'you' : shownName} finished
        on AniList ·
        <a href={listUrl(shownName)}>{Whose(shownName)} list</a>
      </p>
    </div>
  </header>

  {#if yearState.status === 'missing'}
    <div class="notice" role="alert">
      <h2>There's no public AniList list for {data.name}</h2>
      <p>Check the spelling, or make the list public in AniList's settings.</p>
    </div>
  {:else if yearState.status === 'failed' || yearState.status === 'busy'}
    <div class="notice" role="status">
      <h2>
        {yearState.status === 'failed'
          ? "AniList isn't answering right now"
          : 'AniList is busy right now'}
      </h2>
      <p>Please try again in a moment.</p>
      <button type="button" class="tw:btn" disabled={now < retryAt} onclick={() => attempt++}>
        {now < retryAt ? `Try again in ${Math.ceil((retryAt - now) / 1000)}s` : 'Try again'}
      </button>
    </div>
  {:else if !summary}
    <div class="panel loading" aria-hidden="true"><span></span><span></span></div>
    <p class="tw:sr-only" role="status">Reading the year…</p>
  {:else if !summary.finished}
    <div class="notice">
      <h2>No anime finished in {year} {inProgress ? 'yet' : ''}</h2>
      <p>
        Yousoro counts anime with a {year} finish date on AniList, which it sets when an anime is marked
        completed.
      </p>
    </div>
  {:else}
    <dl class="panel stats">
      <div>
        <dt>Anime finished</dt>
        <dd>{count(summary.finished)}</dd>
      </div>
      <div>
        <dt>Episodes</dt>
        <dd>{count(summary.episodes)}</dd>
      </div>
      <div>
        <dt>Hours watched</dt>
        <dd>{count(summary.hours)}</dd>
      </div>
    </dl>

    {#if summary.favorite}
      {@const favorite = summary.favorite}
      <section class="panel feature" aria-labelledby="favorite">
        <span class="feature-cover">
          <SharedAnimePoster anime={favorite} decorative blurMature={data.preferences.blurMature} />
        </span>
        <div class="feature-copy">
          <h2 id="favorite" class="eyebrow">Favorite of the year</h2>
          <p class="feature-title">
            <a
              href={`https://anilist.co/anime/${favorite.id}`}
              target="_blank"
              rel="noopener noreferrer"
              >{favorite.title}<span class="tw:sr-only">, opens in a new tab</span></a
            >
          </p>
          <p class="feature-detail">
            {Who(shownName)} scored it
            <span aria-hidden="true">{scoreOf(favorite)}</span><span class="tw:sr-only"
              >{scoreWords(favorite)}</span
            >
          </p>
        </div>
      </section>
    {/if}

    <div class="facts">
      {#if summary.topGenres.length}
        <section class="panel" aria-labelledby="genres">
          <h2 id="genres" class="eyebrow">Top genres</h2>
          <ol class="genres">
            {#each summary.topGenres as { genre, count: anime } (genre)}
              <li><span>{genre}</span> <span class="muted">{count(anime)} anime</span></li>
            {/each}
          </ol>
        </section>
      {/if}
      {#if summary.busiestMonth}
        <section class="panel" aria-labelledby="busiest">
          <h2 id="busiest" class="eyebrow">Busiest month</h2>
          <p class="fact">{summary.busiestMonth.month}</p>
          <p class="muted">{summary.busiestMonth.count.toLocaleString()} anime finished</p>
        </section>
      {/if}
      {#if summary.longest}
        <section class="panel" aria-labelledby="longest">
          <h2 id="longest" class="eyebrow">Longest watch</h2>
          <p class="fact">{summary.longest.title}</p>
          <p class="muted">{plural(summary.longest.episodes, 'episode')}</p>
        </section>
      {/if}
    </div>

    {#if summary.hotTake}
      {@const take = summary.hotTake}
      <section class="panel hot-take" aria-labelledby="hot-take">
        <h2 id="hot-take" class="eyebrow">Hottest take</h2>
        <p>
          {Who(shownName)} scored <cite>{take.anime.title}</cite>
          <strong aria-hidden="true">{scoreOf(take.anime)}</strong><span class="tw:sr-only"
            >{scoreWords(take.anime)}</span
          >, while AniList users average <strong>{take.meanScore}%</strong>.
          {take.higher ? 'A hidden gem, or a guilty pleasure?' : 'Bold, and probably right.'}
        </p>
      </section>
    {/if}

    {#if summary.seasons.some((season) => season.favorite)}
      <section aria-labelledby="seasons">
        <h2 id="seasons" class="section-heading">Season by season</h2>
        <ul class="seasons">
          {#each summary.seasons as { season, count: finished, favorite } (season)}
            <li class="panel">
              <p class="season-name">{season}</p>
              <p class="muted">{count(finished)} anime finished</p>
              {#if favorite}
                <SharedAnimePoster
                  anime={favorite}
                  blurMature={data.preferences.blurMature}
                  detail={favorite.score
                    ? {
                        badge: scoreOf(favorite),
                        label: `${Who(shownName)} scored it ${scoreWords(favorite)}`,
                      }
                    : undefined}
                />
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- You Watanabe, whose salute names the site, sends them off to compare -->
    <section class="panel final-thought" aria-labelledby="final-thought">
      <img class="final-you" src={YouSvg} alt="" width="1010" height="700" />
      <div class="final-copy">
        <h2 id="final-thought">Who shares {whose(shownName)} taste?</h2>
        <p>
          {summary.topGenres.length
            ? `A year of ${joinNames(summary.topGenres.map(({ genre }) => genre))}. `
            : ''}See how {own ? 'your' : `${shownName}'s`} scores match {own
            ? 'your friends’'
            : 'yours'}, then share the year.
        </p>
        <div class="final-actions">
          <a
            class="tw:btn tw:btn-primary final-link"
            href={own ? `${listUrl(shownName)}/friends` : matchPath(shownName)}
            >{own ? 'Find your taste twins' : `Compare with ${shownName}`}</a
          >
          <ShareButton url={share.url} title={share.title} subject={share.subject} />
        </div>
      </div>
    </section>
  {/if}

  <nav class="years" aria-label="Other years">
    {#if year > FIRST_YEAR}
      <a href={wrappedPath(data.name, year - 1)}><span aria-hidden="true">←</span> {year - 1}</a>
    {/if}
    {#if year < new Date().getFullYear()}
      <a class="next" href={wrappedPath(data.name, year + 1)}
        >{year + 1} <span aria-hidden="true">→</span></a
      >
    {/if}
  </nav>
</section>

<style>
  .wrapped-page {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    max-width: 56rem;
    margin: 24px auto 0;
  }

  .wrapped-header {
    display: flex;
    align-items: center;
    gap: 16px;
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

  .panel,
  .notice {
    padding: 20px 24px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
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

  .eyebrow {
    color: var(--text-accent);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .muted {
    color: var(--text-accent);
    font-size: 0.8125rem;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }

  .stats dt {
    color: var(--text-accent);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .stats dd {
    color: var(--text-heading);
    font-size: clamp(1.75rem, 7vw, 3rem);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    line-height: 1.1;
  }

  .feature {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .feature-cover {
    flex: none;
    width: 110px;
  }

  .feature-copy {
    min-width: 0;
  }

  .feature-title {
    margin-top: 4px;
    color: var(--text-heading);
    font-size: 1.375rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .feature-title a:hover {
    text-decoration: underline;
  }

  .feature-detail {
    margin-top: 6px;
    color: var(--text-accent);
    font-size: 0.9375rem;
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
    gap: 20px;
  }

  .genres {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    color: var(--text-heading);
    font-size: 1rem;
    font-weight: 600;
  }

  .genres .muted {
    font-weight: 500;
  }

  .fact {
    margin-top: 8px;
    color: var(--text-heading);
    font-size: 1.125rem;
    font-weight: 650;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .hot-take p {
    margin-top: 6px;
    color: var(--text-heading);
    font-size: 1rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  cite {
    font-style: normal;
    font-weight: 600;
  }

  .section-heading {
    margin-bottom: 12px;
    color: var(--text-heading);
    font-size: 1.0625rem;
    font-weight: 600;
  }

  .seasons {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .seasons li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px;
  }

  .seasons li > :global(.poster) {
    margin-top: 10px;
  }

  .season-name {
    color: var(--text-heading);
    font-size: 0.9375rem;
    font-weight: 650;
  }

  .final-thought {
    display: flex;
    align-items: center;
    gap: 20px;
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
    overflow-wrap: anywhere;
  }

  .final-copy p {
    margin: 6px 0 12px;
    color: var(--text-heading);
    font-size: 0.9375rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .final-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }

  .final-link {
    min-height: 44px;
  }

  .years {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .years a {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: var(--text-accent);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .years .next {
    margin-left: auto;
  }

  .years a:hover {
    text-decoration: underline;
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

  @media (max-width: 640px) {
    .seasons {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 480px) {
    .wrapped-header {
      align-items: flex-start;
    }

    .panel,
    .notice {
      padding: 18px 16px;
    }

    .stats {
      gap: 10px;
    }

    .feature-cover {
      width: 88px;
    }

    /* You sits above the closing words on a phone, leaving the text the full width */
    .final-thought {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }

    .final-you {
      width: 104px;
    }
  }
</style>
