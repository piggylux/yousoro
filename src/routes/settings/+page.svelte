<script lang="ts">
  import SettingsForm from '#lib/components/SettingsForm.svelte';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>Settings - Yousoro</title>
</svelte:head>

<!-- The gear in the header opens these settings in a drawer; this page is for browsers without
  JavaScript, and where the form saves to -->
<section class="settings">
  <h1 class="heading">Settings</h1>
  <SettingsForm preferences={data.preferences} />
</section>

<style>
  .settings {
    width: 100%;
    max-width: 36rem;
    margin: 0 auto;
  }

  .heading {
    margin-bottom: 20px;
    color: var(--text-heading);
    font-size: 1.5rem;
    font-weight: 800;
  }
</style>
