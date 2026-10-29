<script lang="ts">
  import CopyField from '#lib/components/CopyField.svelte';
  import { badgePath, SITE_ORIGIN } from '#lib/seo.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const own = $derived(data.user?.name.toLowerCase() === data.name.toLowerCase());
  // Most AniList profiles are dark, but a light theme chosen here is the likelier match
  let theme = $derived<'light' | 'dark'>(data.preferences.theme === 'light' ? 'light' : 'dark');

  /*
   * Visitors who click the badge see the list it shows, with every episode and what airs next. A
   * badge stays on a profile for good, so it's always the site's own address, never a preview's
   */
  const listUrl = $derived(`${SITE_ORIGIN}/user/anilist/${encodeURIComponent(data.name)}`);
  const imageUrl = $derived(`${SITE_ORIGIN}${badgePath(data.name, theme)}`);
  const alt = $derived(`What ${data.name} is watching, tracked on Yousoro`);
  const snippets = $derived([
    {
      label: 'AniList profile',
      value: `[img600(${imageUrl})](${listUrl})`,
      hint: 'Paste it into About, under Profile in your AniList settings.',
    },
    {
      label: 'Markdown',
      value: `[![${alt}](${imageUrl})](${listUrl})`,
      hint: 'For a GitHub README, Reddit, or a forum that uses Markdown.',
    },
    {
      label: 'HTML',
      value: `<a href="${listUrl}"><img src="${imageUrl}" alt="${alt}" width="600" height="180"></a>`,
      hint: 'For a website or a forum signature that takes HTML.',
    },
    { label: 'Image link', value: imageUrl, hint: 'For anywhere else that shows images.' },
  ]);
</script>

<section class="badge-page">
  <header>
    <h1>{own ? 'Your profile badge' : `${data.name}'s profile badge`}</h1>
    <p class="summary">
      Show what {own ? "you're" : `${data.name} is`} watching on an AniList profile, in a README, or anywhere
      that shows images. Visitors who click it see {own ? 'your' : `${data.name}'s`} whole list, episode
      by episode. The badge keeps itself up to date, within an hour of each change.
    </p>
  </header>

  <div class="preview" style:color-scheme={theme}>
    <!-- The badge's own size, so its room is kept while it's drawn -->
    <img src={badgePath(data.name, theme)} {alt} width="600" height="180" />
  </div>

  <label class="theme-choice">
    <span>
      <span class="choice-name">Colors</span>
      <span class="choice-hint">Match the page the badge goes on.</span>
    </span>
    <select class="tw:select" bind:value={theme}>
      <option value="dark">Dark</option>
      <option value="light">Light</option>
    </select>
  </label>

  <section class="snippets" aria-labelledby="badge-code">
    <h2 id="badge-code">Copy the code</h2>
    {#each snippets as { label, value, hint } (label)}
      <div>
        <CopyField {label} {value} />
        <p class="hint">{hint}</p>
      </div>
    {/each}
  </section>

  <p class="back">
    <a href={`/user/anilist/${encodeURIComponent(data.name)}`}
      ><span aria-hidden="true">←</span> {own ? 'Your watching list' : `${data.name}'s list`}</a
    >
  </p>
</section>

<style>
  .badge-page {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
    max-width: 44rem;
    margin: 24px auto 0;
  }

  h1 {
    color: var(--text-heading);
    font-size: 1.5rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.25;
    /* AniList names are one word of up to 20 letters, wider than a phone has room for */
    overflow-wrap: anywhere;
  }

  .summary {
    margin-top: 6px;
    color: var(--text-accent);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  /* The badge sits on the colours it's drawn for, as it would on the page it goes on */
  .preview {
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface-muted);
  }

  .preview img {
    display: block;
    width: 100%;
    max-width: 600px;
    height: auto;
    margin: 0 auto;
    border-radius: var(--radius-control);
  }

  .theme-choice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .choice-name {
    display: block;
    color: var(--text-heading);
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .choice-hint {
    display: block;
    color: var(--text-accent);
    font-size: 0.8125rem;
  }

  .theme-choice select {
    width: auto;
    min-height: 44px;
  }

  .snippets {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .snippets h2 {
    color: var(--text-heading);
    font-size: 1.0625rem;
    font-weight: 600;
  }

  .hint {
    margin-top: 6px;
    color: var(--text-accent);
    font-size: 0.8125rem;
  }

  .back a {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: var(--text-accent);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .back a:hover {
    text-decoration: underline;
  }
</style>
