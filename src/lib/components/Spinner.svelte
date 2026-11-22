<script lang="ts">
  /**
   * How large the boat and its sea are drawn. Sized for a page's wait, in `rem` so it grows with
   * the text
   */
  let { size = '4.5rem' }: { size?: string } = $props();

  /** Each spinner's own mask and clip, as several may be on the page at once */
  const uid = $props.id();
  const water = `${uid}-water`;
  const aboveWater = `${uid}-above-water`;
</script>

<!--
  A sailboat bobbing on the waves, drawn like the anchor in the header. Whatever is loading says so
  in text beside it, so the drawing is hidden from assistive technology
-->
<svg
  class="spinner"
  style:--size={size}
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 48 48"
  aria-hidden="true"
>
  <defs>
    <!-- The waves fade out to either side of the boat, rather than ending square -->
    <linearGradient id={`${water}-fade`}>
      <stop offset="0" stop-color="black" />
      <stop offset="0.3" stop-color="white" />
      <stop offset="0.7" stop-color="white" />
      <stop offset="1" stop-color="black" />
    </linearGradient>
    <mask id={water}>
      <rect width="48" height="48" fill={`url(#${water}-fade)`} />
    </mask>
    <!--
      The sea's level, at the front wave's middle. It stays put while the boat bobs and tips, so the
      hull below it is hidden, and the wave's line covers the cut as it rises and falls
    -->
    <clipPath id={aboveWater}>
      <rect x="-16" y="-16" width="80" height="55.5" />
    </clipPath>
  </defs>
  <!-- Both waves repeat every 16 units, so sliding them by 16 loops seamlessly -->
  <g mask={`url(#${water})`}>
    <path class="wave back" d="M-16 35.5q4-2.5 8 0t8 0t8 0t8 0t8 0t8 0t8 0t8 0t8 0t8 0" />
  </g>
  <g clip-path={`url(#${aboveWater})`}>
    <g class="bob">
      <g class="rock">
        <path class="pennant" d="M24 8.5l6.5 2.25L24 13z" />
        <path class="sail" d="M25.5 11Q34 19 37 29.5H25.5z" />
        <path class="sail" d="M22.5 14.5Q16 22 11.5 29.5h11z" />
        <path class="line" d="M24 8v25" />
        <path class="hull line" d="M7 31.5Q24 34.5 41 31.5L36.5 40Q24 42 12.5 40z" />
      </g>
    </g>
  </g>
  <!-- The front wave is the boat's waterline -->
  <g mask={`url(#${water})`}>
    <path class="wave front" d="M-16 39.5q4 2.5 8 0t8 0t8 0t8 0t8 0t8 0t8 0t8 0t8 0t8 0" />
  </g>
</svg>

<style>
  .spinner {
    display: block;
    flex-shrink: 0;
    width: var(--size);
    height: var(--size);
    overflow: hidden;
    color: var(--text-heading);
    fill: none;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sail,
  .line {
    stroke: currentColor;
  }

  .sail {
    fill: currentColor;
    fill-opacity: 0.12;
  }

  .hull {
    fill: currentColor;
  }

  .pennant {
    fill: var(--you-blue);
    transform-box: view-box;
    transform-origin: 24px 10.75px;
    animation: flutter 0.5s ease-in-out infinite alternate;
  }

  .wave {
    stroke: var(--you-blue);
  }

  /* The nearer wave moves faster, for a little depth */
  .wave.back {
    opacity: 0.45;
    animation: roll 2.4s linear infinite;
  }

  .wave.front {
    animation: roll 1.6s linear infinite;
  }

  /*
   * Lifted by each crest of the front wave, once a wave. A crest starts 12 units left of the boat's
   * middle and reaches it 1.2s in, so the bob starts 1.2s through, to be highest just then
   */
  .bob {
    animation: bob 1.6s ease-in-out -1.2s infinite;
  }

  /* Tipping bow and stern in turn about the waterline, once every two waves */
  .rock {
    transform-box: view-box;
    transform-origin: 24px 37px;
    animation: rock 3.2s ease-in-out infinite;
  }

  /* The bow is on the left, so the water runs to the right */
  @keyframes roll {
    to {
      transform: translateX(16px);
    }
  }

  @keyframes bob {
    50% {
      transform: translateY(-1.5px);
    }
  }

  @keyframes rock {
    0%,
    100% {
      transform: rotate(-5deg);
    }
    50% {
      transform: rotate(5deg);
    }
  }

  @keyframes flutter {
    to {
      transform: scaleX(0.7);
    }
  }

  /* Without motion, the boat rests on still water and fades gently, so it still shows a wait */
  @media (prefers-reduced-motion: reduce) {
    .pennant,
    .wave,
    .bob,
    .rock {
      animation: none;
    }

    .spinner {
      animation: fade 2s ease-in-out infinite;
    }
  }

  @keyframes fade {
    50% {
      opacity: 0.45;
    }
  }
</style>
