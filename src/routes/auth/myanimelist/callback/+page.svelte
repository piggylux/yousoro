<script lang="ts">
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<!-- Only shown when the sign-in failed; a successful one redirects before the page is drawn -->
<section class="tw:flex tw:flex-col tw:items-center tw:gap-4">
  <p class="tw:text-error" role="alert">{data.errorMessage}</p>
  <a class="tw:btn" href="/home">Back to home</a>
</section>
