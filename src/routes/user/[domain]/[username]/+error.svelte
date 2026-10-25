<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status} - Yousoro</title>
</svelte:head>

<h1>{page.status}: {page.error?.message}</h1>
