<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { untrack } from 'svelte';

  import SignInButton from '#lib/components/SignInButton.svelte';
  import { SYNC_ENABLED } from '#lib/sync.js';
  import { DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';
  import type {
    CardSize,
    DownloadLanguage,
    DownloadVersion,
    Preferences,
    Theme,
  } from '#lib/types/preferences.js';
  import type { SessionUser } from '#lib/types/session-user.js';

  type Props = {
    /** The viewer's current settings */
    preferences: Preferences;
    /** The AniList account signed in */
    user?: SessionUser | null;
    /** The MyAnimeList account signed in */
    malUser?: SessionUser | null;
    /** Whether this site offers MyAnimeList sign-in */
    malEnabled?: boolean;
    /** Whether the form is showing, in the drawer; each showing starts without the last status */
    shown?: boolean;
    /** The level of the section headings, below the page's or the drawer's own heading */
    headingLevel?: 2 | 3;
  };

  let {
    preferences,
    user = null,
    malUser = null,
    malEnabled = false,
    shown = true,
    headingLevel = 2,
  }: Props = $props();

  const id = $props.id();
  // Each service this site offers, with the account signed in to it
  const accounts = $derived<{ domain: Domain; account: SessionUser | null }[]>([
    { domain: 'anilist', account: user },
    ...(malEnabled ? [{ domain: 'myanimelist' as const, account: malUser }] : []),
  ]);
  const signedIn = $derived(Boolean(user || malUser));
  // Signed in to both: saves go to both, and one of them is the main list
  const linked = $derived(Boolean(user && malUser));
  // Back to this page after signing in or out
  const redirectTo = $derived(page.url.pathname + page.url.search);

  let formElement = $state<HTMLFormElement>();
  let status = $state('');
  // One save at a time: overlapping saves could finish out of order and keep the older choice
  let saving = $state(false);
  // Follows the switch as soon as it moves, so the blur switch greys out without waiting for the save
  let showMature = $derived(preferences.showMature);

  // The last save's status says nothing new once the drawer is opened again, unless a save is
  // still under way
  $effect(() => {
    if (shown) {
      untrack(() => {
        if (!saving) status = '';
      });
    }
  });

  const CARD_SIZE_LABELS: Record<CardSize, string> = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
  };

  const THEME_LABELS: Record<Theme, string> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  };

  const LANGUAGE_LABELS: Record<DownloadLanguage, string> = {
    any: 'Any language',
    english: 'English',
    french: 'French',
  };

  const VERSION_LABELS: Record<DownloadVersion, string> = {
    any: 'Any',
    subbed: 'Subbed',
    dubbed: 'Dubbed',
    'dual-audio': 'Dual audio',
  };
</script>

<!-- Signing in and out has forms of its own, so it stays outside the settings form below -->
<svelte:element this={`h${headingLevel}`} class="section-heading">Accounts</svelte:element>
<div class="panel">
  {#each accounts as { domain, account } (domain)}
    <div class="setting account">
      <span>
        <span class="setting-name">{DOMAIN_NAMES[domain]}</span>
        <span class="setting-hint">
          {account
            ? `Signed in as ${account.name}`
            : signedIn
              ? 'Link it to save your progress there too.'
              : 'Not signed in.'}
        </span>
      </span>
      {#if account}
        <form method="POST" action="/auth/logout">
          <input type="hidden" name="service" value={domain} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button class="tw:btn tw:btn-sm" aria-label={`Sign out of ${DOMAIN_NAMES[domain]}`}>
            Sign out
          </button>
        </form>
      {:else}
        <SignInButton service={domain} {redirectTo} compact linking={signedIn} />
      {/if}
    </div>
  {/each}
  {#if linked}
    <!-- Part of the settings form below, which it saves with -->
    <div class="setting">
      <label for={`${id}-main-list`}>
        <span class="setting-name">Main list</span>
        <span class="setting-hint">
          “My anime” opens this list. Episodes and scores you save go to both.
        </span>
      </label>
      <select
        id={`${id}-main-list`}
        class="choice tw:select tw:select-sm"
        form={`${id}-settings`}
        name="mainList"
        value={preferences.mainList}
        disabled={saving}
        onchange={() => formElement?.requestSubmit()}
      >
        {#each accounts as { domain } (domain)}
          <option value={domain}>{DOMAIN_NAMES[domain]}</option>
        {/each}
      </select>
    </div>
    {#if SYNC_ENABLED}
      <div class="setting account">
        <span>
          <span class="setting-name">Sync your lists</span>
          <span class="setting-hint"
            >Review what differs between them, such as changes made on their sites.</span
          >
        </span>
        <a class="tw:btn tw:btn-sm" href="/sync">Review</a>
      </div>
    {/if}
  {/if}
</div>

<svelte:element this={`h${headingLevel}`} class="section-heading">Display</svelte:element>
<!--
  The settings, saved as soon as one changes. Used in the settings drawer, and on the settings page
  for browsers without JavaScript, where the Save button submits them instead
-->
<form
  id={`${id}-settings`}
  class="panel"
  bind:this={formElement}
  method="POST"
  action="/settings"
  use:enhance={() => {
    saving = true;
    status = 'Saving…';
    return async ({ result, update }) => {
      // Stay on the current page, which refreshes with the new settings, rather than go to the
      // settings page the form posts to
      await update({ reset: false, navigate: false });
      saving = false;
      status = result.type === 'success' ? 'Saved' : "Couldn't save, please try again";
      // The switch moved ahead of the save; when the save fails, it goes back to what's saved
      if (result.type !== 'success') showMature = preferences.showMature;
    };
  }}
>
  {#if !linked}
    <!-- Kept as it is while there's only one list to choose -->
    <input type="hidden" name="mainList" value={preferences.mainList} />
  {/if}
  <label class="setting">
    <span>
      <span class="setting-name">Theme</span>
      <span class="setting-hint">Choose a look, or follow your device.</span>
    </span>
    <select
      class="choice tw:select tw:select-sm"
      name="theme"
      value={preferences.theme}
      disabled={saving}
      onchange={() => formElement?.requestSubmit()}
    >
      {#each Object.entries(THEME_LABELS) as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>

  <label class="setting">
    <span>
      <span class="setting-name">Show mature anime</span>
      <span class="setting-hint">
        Anime AniList marks as adult (18+) are listed. When off, they're left out of every list.
      </span>
    </span>
    <input
      class="tw:toggle tw:toggle-primary"
      type="checkbox"
      name="showMature"
      bind:checked={showMature}
      disabled={saving}
      onchange={() => formElement?.requestSubmit()}
    />
  </label>

  <!-- Only matters while mature anime are shown; otherwise it's kept as it is for later -->
  <label class="setting" class:unavailable={!showMature}>
    <span>
      <span class="setting-name">Blur mature covers</span>
      <span class="setting-hint">
        {showMature
          ? 'Covers of anime AniList marks as adult (18+) are blurred.'
          : 'Mature anime are hidden, so there are no covers to blur.'}
      </span>
    </span>
    <input
      class="tw:toggle tw:toggle-primary"
      type="checkbox"
      name="blurMature"
      checked={preferences.blurMature}
      disabled={saving || !showMature}
      onchange={() => formElement?.requestSubmit()}
    />
    <!-- A disabled switch isn't sent, so its value goes along hidden, unchanged -->
    {#if !showMature && preferences.blurMature}
      <input type="hidden" name="blurMature" value="on" />
    {/if}
  </label>

  <label class="setting">
    <span>
      <span class="setting-name">Card size</span>
      <span class="setting-hint">Smaller cards fit more anime in each row.</span>
    </span>
    <select
      class="choice tw:select tw:select-sm"
      name="cardSize"
      value={preferences.cardSize}
      disabled={saving}
      onchange={() => formElement?.requestSubmit()}
    >
      {#each Object.entries(CARD_SIZE_LABELS) as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>

  <label class="setting">
    <span>
      <span class="setting-name">Episode search language</span>
      <span class="setting-hint"> Find episode only lists releases in this language. </span>
    </span>
    <select
      class="choice tw:select tw:select-sm"
      name="downloadLanguage"
      value={preferences.downloadLanguage}
      disabled={saving}
      onchange={() => formElement?.requestSubmit()}
    >
      {#each Object.entries(LANGUAGE_LABELS) as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>

  <label class="setting">
    <span>
      <span class="setting-name">Subbed or dubbed</span>
      <span class="setting-hint">
        Find episode only lists releases of this kind. Dual audio has both the original and dubbed
        tracks.
      </span>
    </span>
    <select
      class="choice tw:select tw:select-sm"
      name="downloadVersion"
      value={preferences.downloadVersion}
      disabled={saving}
      onchange={() => formElement?.requestSubmit()}
    >
      {#each Object.entries(VERSION_LABELS) as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>

  <noscript>
    <button class="tw:btn tw:btn-primary tw:btn-sm">Save</button>
  </noscript>
</form>

<p class="note">Settings are remembered in this browser.</p>
<p class="status" role="status">{status}</p>

<style>
  .section-heading {
    margin: 24px 0 8px;
    color: var(--text-heading);
    font-size: 0.95rem;
    font-weight: 600;
  }

  .section-heading:first-of-type {
    margin-top: 0;
  }

  .panel {
    display: grid;
    gap: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    overflow: hidden;
  }

  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 20px 16px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    cursor: pointer;
    border-bottom: 1px solid var(--border-subtle);
  }

  /* An account's row, whose button is what's clickable */
  .account {
    cursor: default;
  }

  /* A setting that doesn't apply right now: dimmed, and not clickable */
  .setting.unavailable {
    cursor: not-allowed;
    opacity: 0.55;
  }

  /* Wide enough for the longest choice, with room for the arrow */
  .choice {
    flex: none;
    width: 10rem;
    max-width: 50%;
  }

  .setting-name {
    display: block;
    color: var(--text-heading);
    font-weight: 600;
  }

  .setting-hint {
    display: block;
    margin-top: 2px;
    color: var(--text-accent);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .note {
    margin-top: 12px;
    color: var(--text-accent);
    font-size: 0.8rem;
    opacity: 1;
  }

  .status {
    min-height: 1.5em;
    margin-top: 4px;
    color: var(--text-accent);
    font-size: 0.85rem;
  }
  .setting:last-of-type {
    border-bottom: 0;
  }
  .setting > span,
  .setting > label {
    min-width: 0;
  }

  .setting > label {
    cursor: pointer;
  }
  @media (max-width: 440px) {
    .setting {
      gap: 12px;
      padding: 16px 12px;
    }
    .choice {
      width: 8rem;
      max-width: 45%;
    }
  }
</style>
