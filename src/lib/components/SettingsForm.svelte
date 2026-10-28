<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';

  import type {
    CardSize,
    DownloadLanguage,
    DownloadVersion,
    Preferences,
    Theme,
  } from '#lib/types/preferences.js';

  type Props = {
    /** The viewer's current settings */
    preferences: Preferences;
    /** Whether the form is showing, in the drawer; each showing starts without the last status */
    shown?: boolean;
  };

  let { preferences, shown = true }: Props = $props();

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

<!--
  The settings, saved as soon as one changes. Used in the settings drawer, and on the settings page
  for browsers without JavaScript, where the Save button submits them instead
-->
<form
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
      <span class="setting-name">Release language</span>
      <span class="setting-hint">
        The language the nyaa.si search on your own list looks for.
      </span>
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
      <span class="setting-name">Release version</span>
      <span class="setting-hint"> Subtitles, a dub, or both audio tracks, in that language. </span>
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
  form {
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
  .setting > span {
    min-width: 0;
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
