<script lang="ts">
  import { page } from '$app/state';

  import { getPageSeo, jsonLdScript, SHARE_IMAGE, SITE_NAME, WEBSITE_SCHEMA } from '#lib/seo.js';

  const resolvedUsername = $derived(
    typeof page.data.username === 'string' ? page.data.username : undefined
  );
  const seo = $derived(getPageSeo(page.url, page.status, resolvedUsername));
  const noindex = $derived(seo.noindex || Boolean(page.data.user));
</script>

<svelte:head>
  <title>{seo.title}</title>
  <meta name="description" content={seo.description} />
  <meta
    name="robots"
    content={noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}
  />
  {#if seo.canonical}<link rel="canonical" href={seo.canonical} />{/if}
  <meta property="og:site_name" content={SITE_NAME} />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content={seo.title} />
  <meta property="og:description" content={seo.description} />
  {#if seo.canonical}<meta property="og:url" content={seo.canonical} />{/if}
  <meta property="og:image" content={SHARE_IMAGE} />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="512" />
  <meta property="og:image:height" content="512" />
  <meta property="og:image:alt" content="Yousoro logo" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content={seo.title} />
  <meta name="twitter:description" content={seo.description} />
  <meta name="twitter:image" content={SHARE_IMAGE} />
  <meta name="twitter:image:alt" content="Yousoro logo" />
  {#if seo.home}
    {@html jsonLdScript(WEBSITE_SCHEMA)}
  {/if}
</svelte:head>
