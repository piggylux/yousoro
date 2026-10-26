<script lang="ts">
  import { onMount } from 'svelte';

  import YouSvg from '#lib/images/minimalist_you.svg';

  type Props = {
    kind: 'caught-up' | 'completed';
    title: string;
    /** Called once the animation has finished, so the parent can remove it */
    onDone?: () => void;
  };

  let { kind, title, onDone }: Props = $props();

  /** Matches the CSS timeline below */
  const DURATION_MS = 5000;

  onMount(() => {
    const timer = setTimeout(() => onDone?.(), DURATION_MS);
    return () => clearTimeout(timer);
  });

  const message = $derived(kind === 'completed' ? `Completed ${title}!` : `Caught up on ${title}!`);

  // You's sailor colours, with a bit of sunshine
  const CONFETTI_COLORS = ['#49b9f9', '#145f9c', '#ffffff', '#ffd23f', '#9fdcff'];

  /**
   * Confetti pieces, each falling from a random place above the screen with its own colour, size,
   * speed, sideways drift and spin. More for finishing an anime than for catching up
   */
  const confetti = $derived(
    Array.from({ length: kind === 'completed' ? 80 : 45 }, (_, i) => ({
      x: Math.random() * 100,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      round: Math.random() < 0.3,
      size: 6 + Math.random() * 6,
      delay: Math.random() * 1.2,
      duration: 2.6 + Math.random() * 1.6,
      drift: (Math.random() - 0.5) * 160,
      spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720),
    }))
  );
</script>

<!-- A shower of confetti over the whole screen, which never blocks clicks either -->
<div class="confetti" aria-hidden="true">
  {#each confetti as piece, i (i)}
    <span
      class="piece"
      class:round={piece.round}
      style:left="{piece.x}%"
      style:--size="{piece.size}px"
      style:--color={piece.color}
      style:--delay="{piece.delay}s"
      style:--duration="{piece.duration}s"
      style:--drift="{piece.drift}px"
      style:--spin="{piece.spin}deg"
    ></span>
  {/each}
</div>

<!--
  You Watanabe sails in on the waves with her "Yousoro!" salute when a show is caught up on or
  finished. It sits in a corner and never blocks clicks.
-->
<div class="celebration {kind}" role="status">
  <p class="tw:sr-only">Yousoro! {message}</p>

  <div class="scene" aria-hidden="true">
    <div class="bubble">
      <strong>{kind === 'completed' ? '🎉' : '⚓'} ヨーソロー!</strong>
      <span>{message}</span>
    </div>

    {#if kind === 'completed'}
      <span class="sparkle s1">✦</span>
      <span class="sparkle s2">✦</span>
      <span class="sparkle s3">✦</span>
    {/if}

    <img class="you" src={YouSvg} alt="" />

    <span class="sea-bubble b1"></span>
    <span class="sea-bubble b2"></span>
    <span class="sea-bubble b3"></span>

    <svg class="waves" viewBox="0 0 800 60" preserveAspectRatio="none">
      <!-- The waves repeat every 200 units, so sliding them by half the width loops seamlessly -->
      <path
        class="wave back"
        d="M0 30 Q 50 10 100 30 T 200 30 T 300 30 T 400 30 T 500 30 T 600 30 T 700 30 T 800 30 V 60 H 0 Z"
      />
      <path
        class="wave front"
        d="M0 34 Q 50 52 100 34 T 200 34 T 300 34 T 400 34 T 500 34 T 600 34 T 700 34 T 800 34 V 60 H 0 Z"
      />
    </svg>
  </div>
</div>

<style>
  .celebration {
    position: fixed;
    right: 24px;
    bottom: 0;
    z-index: 50;
    width: 280px;
    pointer-events: none;
    /* The whole scene fades away at the very end */
    animation: scene-out 0.4s ease-in 4.6s forwards;
  }

  .scene {
    position: relative;
    height: 260px;
    overflow: hidden;
  }

  .you {
    position: absolute;
    bottom: 18px;
    left: 50%;
    width: 240px;
    translate: -50% 0;
    filter: drop-shadow(0 6px 10px rgb(15 61 110 / 0.25));
    /* Rises in with a little overshoot, bobs on the water, then sinks back down */
    animation:
      sail-in 0.7s cubic-bezier(0.2, 1.4, 0.4, 1) both,
      bob 1.6s ease-in-out 0.7s 2,
      sail-out 0.45s ease-in 4.3s forwards;
  }

  .bubble {
    position: absolute;
    top: 0;
    left: 8px;
    max-width: 210px;
    padding: 8px 12px;
    border: 2px solid var(--you-blue);
    border-radius: 14px 14px 14px 4px;
    background: var(--surface);
    color: var(--text-heading);
    box-shadow: 0 6px 16px rgb(15 61 110 / 0.2);
    font-size: 0.8rem;
    line-height: 1.3;
    transform-origin: bottom left;
    animation:
      bubble-pop 0.4s cubic-bezier(0.2, 1.6, 0.4, 1) 0.45s both,
      bubble-out 0.25s ease-in 4.2s forwards;
  }

  .bubble strong {
    display: block;
    color: var(--text-accent);
    font-size: 1.05rem;
  }

  .waves {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 200%;
    height: 44px;
    animation: roll 2s linear infinite;
  }

  .wave.back {
    fill: var(--you-blue);
    opacity: 0.45;
  }

  .wave.front {
    fill: var(--sea-blue);
    opacity: 0.85;
  }

  .sea-bubble {
    position: absolute;
    bottom: 20px;
    width: 8px;
    height: 8px;
    border: 2px solid var(--you-blue);
    border-radius: 50%;
    opacity: 0;
    animation: rise 1.6s ease-out infinite;
  }

  .b1 {
    left: 30%;
    animation-delay: 0.6s;
  }

  .b2 {
    left: 62%;
    width: 6px;
    height: 6px;
    animation-delay: 1.1s;
  }

  .b3 {
    left: 78%;
    animation-delay: 1.5s;
  }

  .sparkle {
    position: absolute;
    color: var(--you-blue);
    font-size: 1.1rem;
    opacity: 0;
    animation: twinkle 0.9s ease-in-out infinite;
  }

  .s1 {
    top: 70px;
    right: 22px;
    animation-delay: 0.6s;
  }

  .s2 {
    top: 110px;
    left: 14px;
    animation-delay: 0.9s;
  }

  .s3 {
    top: 58px;
    left: 62%;
    animation-delay: 1.2s;
  }

  @keyframes sail-in {
    from {
      translate: -50% 110%;
    }
    to {
      translate: -50% 0;
    }
  }

  @keyframes bob {
    50% {
      rotate: -2deg;
      translate: -50% -6px;
    }
  }

  @keyframes sail-out {
    to {
      translate: -50% 110%;
    }
  }

  @keyframes bubble-pop {
    from {
      scale: 0;
      opacity: 0;
    }
    to {
      scale: 1;
      opacity: 1;
    }
  }

  @keyframes bubble-out {
    to {
      scale: 0.6;
      opacity: 0;
    }
  }

  @keyframes roll {
    to {
      translate: -50% 0;
    }
  }

  @keyframes rise {
    0% {
      opacity: 0;
      translate: 0 0;
    }
    20% {
      opacity: 0.9;
    }
    100% {
      opacity: 0;
      translate: 6px -90px;
    }
  }

  @keyframes twinkle {
    0%,
    100% {
      opacity: 0;
      scale: 0.5;
    }
    50% {
      opacity: 1;
      scale: 1.2;
    }
  }

  @keyframes scene-out {
    to {
      opacity: 0;
    }
  }

  .confetti {
    position: fixed;
    inset: 0;
    z-index: 49;
    overflow: hidden;
    pointer-events: none;
    animation: scene-out 0.4s ease-in 4.6s forwards;
  }

  /* Paper strips, and some dots, that tumble as they fall */
  .piece {
    position: absolute;
    top: -20px;
    width: var(--size);
    height: calc(var(--size) * 1.6);
    border-radius: 2px;
    background: var(--color);
    box-shadow: 0 0 0 1px rgb(15 61 110 / 0.08);
    opacity: 0;
    animation: fall var(--duration) cubic-bezier(0.25, 0.4, 0.55, 1) var(--delay) forwards;
  }

  .piece.round {
    height: var(--size);
    border-radius: 50%;
  }

  @keyframes fall {
    0% {
      opacity: 1;
      translate: 0 0;
      rotate: 0deg;
    }
    85% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      translate: var(--drift) 105vh;
      rotate: var(--spin);
    }
  }

  /* Without motion: the same message and picture, simply fading in and out */
  @media (prefers-reduced-motion: reduce) {
    .you,
    .bubble,
    .waves,
    .sea-bubble,
    .sparkle {
      animation: none;
    }

    .sea-bubble,
    .sparkle,
    .confetti {
      display: none;
    }

    .celebration {
      animation:
        fade-in 0.3s ease-out both,
        scene-out 0.4s ease-in 4.6s forwards;
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
