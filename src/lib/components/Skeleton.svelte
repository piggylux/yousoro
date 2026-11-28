<script lang="ts">
  type Props = {
    /** As wide as its container when left out */
    width?: string;
    /** A line of small text when left out */
    height?: string;
    /** Width to height, as "3 / 4" for a cover, in place of a height */
    ratio?: string;
    /** A circle, for an avatar */
    round?: boolean;
  };

  let { width = '100%', height = '0.75rem', ratio, round = false }: Props = $props();
</script>

<!--
  A placeholder for something on its way, in the shape of what will take its place. Hidden from
  screen readers: whatever holds it says what's loading
-->
<span
  class="skeleton"
  class:round
  aria-hidden="true"
  style:width
  style:height={ratio ? 'auto' : height}
  style:aspect-ratio={ratio}
></span>

<style>
  /* Still rather than shimmering, so a long wait doesn't draw the eye */
  .skeleton {
    display: block;
    flex: none;
    max-width: 100%;
    border-radius: var(--radius-control);
    background: var(--skeleton);
  }
  .round {
    border-radius: 50%;
  }
</style>
