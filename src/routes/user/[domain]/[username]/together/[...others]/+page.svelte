<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { untrack } from 'svelte';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import CloseButton from '#lib/components/CloseButton.svelte';
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import ShareButton from '#lib/components/ShareButton.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { joinNames, voiceFor } from '#lib/match-words.js';
  import { loadTasteProfile, parseUserName, type TasteProfileState } from '#lib/match.js';
  import { describeScore } from '#lib/score.js';
  import { MAX_GROUP, pickForGroup, togetherPath, type GroupPick } from '#lib/together.js';
  import type { TasteProfile } from '#lib/types/match.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const names = $derived([data.host, ...data.others]);
  // Read again only when the group changes, not when other page data does
  const groupKey = $derived(names.join('/'));

  /*
   * Everyone's list, by name in lower case, kept as the group changes: removing someone reads no
   * list, and adding someone reads only theirs. "Try again" reads again only the lists AniList
   * didn't answer
   */
  let byName = $state<Record<string, TasteProfileState>>({});
  let attempt = $state(0);
  $effect(() => {
    void attempt;
    for (const name of groupKey.split('/')) {
      const key = name.toLowerCase();
      const known = untrack(() => byName[key]);
      if (known && known.status !== 'busy' && known.status !== 'failed') continue;
      byName[key] = { status: 'loading' };
      loadTasteProfile(name).then((state) => (byName[key] = state));
    }
  });
  const states = $derived(
    names.map((name): TasteProfileState => byName[name.toLowerCase()] ?? { status: 'loading' })
  );

  const missing = $derived(names.filter((_, index) => states[index]?.status === 'missing'));
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

  const profileAt = (index: number): TasteProfile | null => {
    const state = states[index];
    return state?.status === 'ready' ? state.profile : null;
  };
  // As AniList spells them once read, as typed until then
  const spelled = $derived(names.map((name, index) => profileAt(index)?.name ?? name));
  // Everyone whose list could be read, once each: two names of one account are one person
  const people = $derived(
    names
      .map((_, index) => profileAt(index))
      .filter((profile, index, all): profile is TasteProfile =>
        Boolean(profile && all.findIndex((other) => other?.id === profile.id) === index)
      )
  );
  const picks = $derived(
    settled && people.length > 1
      ? pickForGroup(people, { showMature: data.preferences.showMature })
      : null
  );

  const voice = $derived(voiceFor(data.user?.name));
  const { isViewer, who, Who } = $derived(voice);
  const viewerIn = $derived(spelled.some(isViewer));
  const canJoin = $derived(
    data.user !== null && !viewerIn && data.others.length > 0 && names.length < MAX_GROUP
  );
  const full = $derived(names.length >= MAX_GROUP);

  // The viewer comes first among names, as "you"
  const everyone = $derived(
    joinNames(
      spelled.toSorted((a, b) => Number(isViewer(b)) - Number(isViewer(a))).map((name) => who(name))
    )
  );

  const share = $derived(
    data.others.length
      ? {
          url: `${page.url.origin}${togetherPath(spelled[0], spelled.slice(1))}`,
          title: `What should ${joinNames(spelled)} watch together? On Yousoro`,
          subject: 'this group',
        }
      : {
          url: `${page.url.origin}${togetherPath(spelled[0])}`,
          title: `Pick an anime to watch with ${isViewer(spelled[0]) ? 'me' : spelled[0]} on Yousoro`,
          subject: 'your group link',
        }
  );

  /*
   * The button goes with the person, so focus moves to the list they left: not to the form, which
   * would open a phone's keyboard
   */
  let membersHeading = $state<HTMLElement>();
  async function remove(index: number) {
    const others = data.others.filter((_, other) => other !== index - 1);
    await goto(togetherPath(data.host, others), { reset: false });
    membersHeading?.focus();
  }

  /*
   * What's wrong with the name in the form: as the load found it, or caught here before sending it,
   * so nobody waits on a page load to learn they typed someone already in the group
   */
  let formError = $derived<'invalid' | 'full' | 'member' | null>(data.formError);
  let typed = $derived(data.typed);
  let nameInput = $state<HTMLInputElement>();
  function checkName(event: SubmitEvent) {
    const name = parseUserName(typed);
    formError = !name
      ? 'invalid'
      : names.some((member) => member.toLowerCase() === name.toLowerCase())
        ? 'member'
        : full
          ? 'full'
          : null;
    if (!formError) return;
    event.preventDefault();
    nameInput?.focus();
  }

  function memberNote(index: number) {
    const state = states[index];
    if (!state || state.status === 'loading') return 'Reading their list…';
    if (state.status === 'missing') return 'No public AniList list';
    if (state.status !== 'ready') return 'Waiting for AniList';
    const { scored, planned } = state.profile;
    return `${count(scored.length)} scored · ${count(planned.length)} planned`;
  }

  /** Who vouches for a pick and who wants to see it, for its caption and its poster's label */
  function reasons({ lovedBy, plannedBy }: GroupPick) {
    return [
      lovedBy.length ? `Loved by ${joinNames(lovedBy.map(({ name }) => who(name)))}` : null,
      plannedBy.length ? `Planned by ${joinNames(plannedBy.map(who))}` : null,
    ].filter((reason) => reason !== null);
  }

  function scores({ lovedBy }: GroupPick) {
    return lovedBy.map(
      ({ name, score, scoreFormat }) =>
        `${Who(name)} scored it ${describeScore(score, scoreFormat)}`
    );
  }

  const listUrl = (name: string) => `/user/anilist/${encodeURIComponent(name)}`;
  const count = (value: number) => value.toLocaleString();
</script>

<AutoReadRetry
  retryKey={`together:${groupKey}`}
  {retryAt}
  recovered={settled}
  onretry={() => attempt++}
/>

<section class="together-page">
  <header class="together-header">
    <div class="heading-copy">
      <div class="title-row">
        <h1>
          {#if !data.others.length}
            {isViewer(spelled[0])
              ? 'Pick an anime to watch together'
              : `Pick an anime to watch with ${spelled[0]}`}
          {:else if viewerIn}
            What should we watch?
          {:else}
            What should {joinNames(spelled)} watch?
          {/if}
        </h1>
        <ShareButton url={share.url} title={share.title} subject={share.subject} />
      </div>
      <p class="summary">
        {#if data.others.length}
          Anime for {everyone} to start together, from everyone's AniList scores and plan lists.
        {:else}
          Add up to {MAX_GROUP - 1} people, or share this page so friends can join.
        {/if}
      </p>
    </div>
  </header>

  <section class="members" aria-labelledby="members-heading">
    <h2 id="members-heading" tabindex="-1" bind:this={membersHeading}>
      Who's watching <span class="members-count">{names.length} of {MAX_GROUP}</span>
    </h2>
    <ul>
      {#each names as name, index (name.toLowerCase())}
        {@const profile = profileAt(index)}
        <li>
          <a class="member" href={listUrl(spelled[index])}>
            <FriendAvatar
              id={profile?.id ?? 0}
              {name}
              avatarUrl={profile?.avatarUrl ?? null}
              size={40}
            />
            <span class="member-identity">
              <strong
                >{isViewer(spelled[index]) ? `You · ${spelled[index]}` : spelled[index]}</strong
              >
              <span>{index === 0 ? 'Started the group · ' : ''}{memberNote(index)}</span>
            </span>
          </a>
          {#if index > 0}
            <CloseButton
              label={`Remove ${spelled[index]} from the group`}
              onclick={() => remove(index)}
            />
          {/if}
        </li>
      {/each}
    </ul>

    {#if canJoin && data.user}
      <a
        class="tw:btn tw:btn-primary join"
        href={togetherPath(data.host, [...data.others, data.user.name])}>Join this group</a
      >
    {/if}

    <form
      class="add-form"
      method="get"
      action={togetherPath(data.host, data.others)}
      onsubmit={checkName}
    >
      <label for="add-name"
        >{!data.others.length && !isViewer(spelled[0]) ? 'Your AniList name' : 'Add someone'}</label
      >
      <div class="add-row">
        <input
          bind:this={nameInput}
          id="add-name"
          class="tw:input"
          name="add"
          required
          bind:value={typed}
          placeholder="AniList name or profile link"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          disabled={full}
          aria-invalid={formError ? 'true' : undefined}
          aria-describedby={formError || full ? 'add-error' : undefined}
          oninput={() => (formError = null)}
        />
        <button class="tw:btn" disabled={full}>Add</button>
      </div>
      {#if formError || full}
        <p id="add-error" class="form-error">
          {#if formError === 'invalid'}
            That doesn't look like an AniList name. Try the name shown on their profile.
          {:else if formError === 'member'}
            They're already in the group.
          {:else}
            Groups have up to {MAX_GROUP} people. Remove someone to add another.
          {/if}
        </p>
      {/if}
    </form>
  </section>

  {#if missing.length}
    <div class="notice" role="alert">
      <h2>
        {missing.length === 1
          ? `There's no public AniList list for ${missing[0]}`
          : `There are no public AniList lists for ${joinNames(missing)}`}
      </h2>
      <p>
        {missing.some(isViewer)
          ? 'Make your list public in your AniList settings so it counts.'
          : 'Check the spelling, or ask them to make their list public on AniList.'}
        Picks leave {missing.length === 1 ? 'them' : 'those lists'} out until then.
      </p>
    </div>
  {/if}
  {#if failed || (retryAt && !settled)}
    <div class="notice" role="status">
      <h2>{failed ? "AniList isn't answering right now" : 'AniList is busy right now'}</h2>
      <p>Please try again in a moment.</p>
      <button type="button" class="tw:btn" disabled={now < retryAt} onclick={() => attempt++}>
        {now < retryAt ? `Try again in ${Math.ceil((retryAt - now) / 1000)}s` : 'Try again'}
      </button>
    </div>
  {/if}

  {#if data.others.length && !settled && !failed && !retryAt}
    <div class="result loading" aria-hidden="true"><span></span><span></span></div>
    <p class="tw:sr-only" role="status">Reading everyone's lists…</p>
  {:else if picks}
    {@const [top, ...more] = picks}
    {#if top}
      <div class="result">
        <span class="top-cover">
          <SharedAnimePoster
            anime={top.anime}
            decorative
            blurMature={data.preferences.blurMature}
          />
        </span>
        <div class="top-copy">
          <p class="eyebrow">Top pick</p>
          <h2>
            <a
              href={`https://anilist.co/anime/${top.anime.id}`}
              target="_blank"
              rel="noopener noreferrer"
              >{top.anime.title}<span class="tw:sr-only">, opens in a new tab</span></a
            >
          </h2>
          <ul class="reasons">
            {#each reasons(top) as reason (reason)}<li>{reason}</li>{/each}
            <li>
              New to {top.newTo === people.length ? 'everyone' : `${top.newTo} of ${people.length}`}
            </li>
          </ul>
          {#if top.lovedBy.length}
            <p class="scores">{scores(top).join(' · ')}</p>
          {/if}
          <ShareButton url={share.url} title={share.title} subject={share.subject} />
        </div>
      </div>
    {:else}
      <div class="notice">
        <h2>Nothing fits everyone yet</h2>
        <p>
          Picks are anime someone in the group loved, or several of you plan to watch, that nobody
          has seen without loving. Scores and plan lists on AniList count right away, so try again
          after adding some, or change the group.
        </p>
      </div>
    {/if}

    {#if more.length}
      <section class="picks" aria-labelledby="more-picks">
        <h2 id="more-picks">More picks</h2>
        <ul class="poster-grid">
          {#each more as pick (pick.anime.id)}
            {@const why = reasons(pick)}
            <li>
              <SharedAnimePoster
                anime={pick.anime}
                blurMature={data.preferences.blurMature}
                detail={{
                  badge: `${pick.lovedBy.length + pick.plannedBy.length} of ${people.length}`,
                  label: [...why, ...scores(pick)].join('; '),
                }}
              />
              <p class="pick-reasons" aria-hidden="true">
                {#each why as reason (reason)}<span>{reason}</span>{/each}
              </p>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</section>

<style>
  .together-page {
    display: flex;
    flex-direction: column;
    gap: 28px;
    width: 100%;
    max-width: 56rem;
    margin: 24px auto 0;
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
    overflow-wrap: anywhere;
  }

  .members,
  .result,
  .notice {
    padding: 20px 24px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .members h2,
  .picks h2,
  .notice h2 {
    color: var(--text-heading);
    font-size: 1.0625rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  /* Focused from script only, when someone leaves the group, as main is */
  #members-heading {
    outline: none;
  }

  .members-count {
    margin-left: 6px;
    color: var(--text-accent);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .members ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    gap: 8px;
    margin-top: 12px;
  }

  .members li {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 4px 4px 4px 8px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
  }

  .member {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 44px;
    border-radius: var(--radius-control);
  }

  .member-identity {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .member-identity strong {
    overflow: hidden;
    color: var(--text-heading);
    font-size: 0.875rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member-identity span {
    color: var(--text-accent);
    font-size: 0.75rem;
  }

  .member:hover strong {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .join {
    min-height: 44px;
    margin-top: 16px;
  }

  .add-form {
    margin-top: 16px;
  }

  .add-form label {
    display: block;
    margin-bottom: 8px;
    color: var(--text-heading);
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .add-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .add-row input {
    flex: 1 1 14rem;
    min-width: 0;
    min-height: 44px;
  }

  .add-row button {
    flex: none;
    min-height: 44px;
    padding-inline: 20px;
  }

  .form-error {
    margin-top: 8px;
    color: var(--text-heading);
    font-size: 0.8125rem;
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

  .result {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }

  .top-cover {
    flex: none;
    width: 120px;
  }

  .top-copy {
    min-width: 0;
  }

  .eyebrow {
    color: var(--text-accent);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .top-copy h2 {
    margin-top: 2px;
    color: var(--text-heading);
    font-size: 1.375rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .top-copy h2 a:hover {
    text-decoration: underline;
  }

  .reasons {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin-top: 8px;
    color: var(--text-heading);
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }

  .scores {
    margin: 6px 0 10px;
    color: var(--text-accent);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .picks h2 {
    margin-bottom: 12px;
  }

  .poster-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 16px;
  }

  .pick-reasons {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 6px;
    color: var(--text-accent);
    font-size: 0.75rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
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

  @media (max-width: 480px) {
    .members,
    .result,
    .notice {
      padding: 18px 16px;
    }

    .top-cover {
      width: 88px;
    }

    .add-row button {
      flex: 1 1 100%;
    }
  }
</style>
