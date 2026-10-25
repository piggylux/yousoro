<script lang="ts">
  import { enhance } from '$app/forms';

  import type { DownloadLanguage, DownloadVersion } from '#lib/types/preferences.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let formElement = $state<HTMLFormElement>();
  let status = $state('');
  // One save at a time: overlapping saves could finish out of order and keep the older choice
  let saving = $state(false);

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

<svelte:head>
  <title>Settings - Yousoro</title>
</svelte:head>

<section class="settings">
  <h1 class="heading">Settings</h1>

  <!-- Saves as soon as a setting changes; without JavaScript, the Save button submits them instead -->
  <form
    bind:this={formElement}
    method="POST"
    use:enhance={() => {
      saving = true;
      status = 'Saving…';
      return async ({ result, update }) => {
        await update({ reset: false });
        saving = false;
        status = result.type === 'success' ? 'Saved' : "Couldn't save, please try again";
      };
    }}
  >
    <label class="setting">
      <span>
        <span class="setting-name">Blur mature covers</span>
        <span class="setting-hint">
          Covers of anime AniList marks as adult (18+) are blurred. Remembered in this browser.
        </span>
      </span>
      <input
        class="tw:toggle tw:toggle-primary"
        type="checkbox"
        name="blurMature"
        checked={data.preferences.blurMature}
        disabled={saving}
        onchange={() => formElement?.requestSubmit()}
      />
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
        value={data.preferences.downloadLanguage}
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
        <span class="setting-hint">
          Subtitles, a dub, or both audio tracks, in that language.
        </span>
      </span>
      <select
        class="choice tw:select tw:select-sm"
        name="downloadVersion"
        value={data.preferences.downloadVersion}
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

  <p class="status" role="status">{status}</p>
</section>

<style>
  .settings {
    width: 100%;
    max-width: 36rem;
    margin: 0 auto;
  }

  .heading {
    margin-bottom: 20px;
    color: var(--navy);
    font-size: 1.5rem;
    font-weight: 800;
  }

  form {
    display: grid;
    gap: 12px;
  }

  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 16px 18px;
    border: 1px solid #cdeafd;
    border-radius: var(--radius-box, 1rem);
    background: #ffffff;
    box-shadow: 0 1px 3px rgb(15 61 110 / 0.08);
    cursor: pointer;
  }

  /* Wide enough for the longest choice, with room for the arrow */
  .choice {
    flex: none;
    width: 10rem;
    max-width: 50%;
  }

  .setting-name {
    display: block;
    color: var(--navy);
    font-weight: 700;
  }

  .setting-hint {
    display: block;
    margin-top: 2px;
    color: var(--sea-blue);
    font-size: 0.85rem;
  }

  .status {
    min-height: 1.5em;
    margin-top: 10px;
    color: var(--sea-blue);
    font-size: 0.85rem;
  }
</style>
