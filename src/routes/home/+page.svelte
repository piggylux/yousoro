<script lang="ts">
  import SignInButton from '#lib/components/SignInButton.svelte';
  import YouSvg from '#lib/images/minimalist_you.svg';
</script>

<div class="home">
  <section class="hero" aria-labelledby="welcome-title">
    <div class="intro">
      <p class="eyebrow"><span aria-hidden="true">⚓</span> Yousoro · ヨーソロー!</p>
      <h1 id="welcome-title">Your next episode.<br /><span>Full speed ahead.</span></h1>
      <p class="description">
        Track your AniList watching list, catch up on aired anime episodes, and plan your next watch
        with an episode calendar. Keep your anime on course with a little help from You.
      </p>
      <div class="start">
        <SignInButton redirectTo="/home" />
        <p class="sign-in-hint">Connect your AniList. Pick up where you left off.</p>
      </div>
    </div>

    <div class="illustration" aria-hidden="true">
      <div class="sun"></div>
      <div class="orbit"></div>
      <span class="spark spark-one">✦</span>
      <span class="spark spark-two">✦</span>
      <img src={YouSvg} alt="" fetchpriority="high" />
      <div class="sail-note">
        <span>⚓</span>
        <p>A little more sunshine.<br />One episode at a time.</p>
      </div>
    </div>
  </section>

  <section class="features" aria-label="What you can do with Yousoro">
    <article>
      <span class="feature-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
      </span>
      <h2>Know what’s next</h2>
      <p>See what’s aired and when the next episode lands. Your next watch, all in one place.</p>
    </article>
    <article>
      <span class="feature-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 7h16M4 12h10M4 17h6m5 0 2 2 4-5" />
        </svg>
      </span>
      <h2>Find your way back</h2>
      <p>A clear view of your backlog, so you can catch up at your own pace. No pressure.</p>
    </article>
    <article>
      <span class="feature-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-1l3 3M4 15l3 3a7 7 0 0 0 11-1" />
        </svg>
      </span>
      <h2>Watch. Tap. Yousoro!</h2>
      <p>Mark an episode watched and keep your AniList progress in sync. On to the next one.</p>
    </article>
  </section>
  <p class="sign-off">Made for your watching list.</p>
</div>

<style>
  .home {
    width: min(100%, 1120px);
    margin: auto;
    padding: 32px 20px 0;
    color: var(--text-heading);
  }

  .hero {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    align-items: center;
    gap: 20px;
    min-height: 430px;
  }

  .intro {
    position: relative;
    z-index: 1;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  h1 {
    margin-top: 24px;
    font-size: clamp(2.25rem, 4.3vw, 3.5rem);
    font-weight: 850;
    line-height: 1.12;
    letter-spacing: -0.045em;
  }

  h1 span {
    color: var(--text-accent);
  }

  .description {
    max-width: 29rem;
    margin-top: 20px;
    color: var(--text-accent);
    font-size: 1rem;
    line-height: 1.75;
    text-wrap: pretty;
  }

  .start {
    margin-top: 28px;
  }

  .sign-in-hint {
    margin-top: 12px;
    color: var(--text-accent);
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .illustration {
    position: relative;
    display: grid;
    place-items: center;
    min-width: 0;
    height: 390px;
  }

  .sun {
    position: absolute;
    width: 290px;
    aspect-ratio: 1;
    border-radius: 50%;
    background: linear-gradient(145deg, light-dark(#c0eaff, #224e70), light-dark(#9fdcff, #183b58));
  }

  .orbit {
    position: absolute;
    width: 350px;
    max-width: 95%;
    aspect-ratio: 1;
    border: 1px solid var(--border-subtle);
    border-radius: 50%;
  }

  .illustration img {
    position: relative;
    width: 100%;
    height: auto;
    user-select: none;
    filter: drop-shadow(0 12px 20px rgb(15 48 79 / 0.12));
  }

  .spark {
    position: absolute;
    z-index: 1;
    color: var(--you-blue);
    font-size: 2rem;
  }

  .spark-one {
    top: 40px;
    right: 40px;
  }

  .spark-two {
    bottom: 70px;
    left: 35px;
    font-size: 1.25rem;
  }

  .sail-note {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 10px;
    right: 10px;
    bottom: 28px;
    padding: 12px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text-accent);
    box-shadow: 0 8px 24px rgb(15 48 79 / 0.1);
    font-size: 0.8rem;
    line-height: 1.5;
    rotate: -4deg;
  }

  .sail-note span {
    font-size: 1.5rem;
  }

  .features {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-top: 40px;
  }

  article {
    padding: 24px;
    border: 1px solid var(--border-subtle);
    border-radius: 20px;
    background: var(--surface);
  }

  .feature-icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
  }

  .feature-icon svg {
    width: 22px;
    height: 22px;
  }

  h2 {
    margin-top: 16px;
    font-size: 1rem;
    font-weight: 750;
  }

  article p {
    margin-top: 8px;
    color: var(--text-accent);
    font-size: 0.85rem;
    line-height: 1.7;
  }

  .sign-off {
    margin-top: 28px;
    color: var(--text-accent);
    font-size: 0.75rem;
    text-align: center;
  }

  @media (max-width: 760px) {
    .home {
      padding: 16px 0 0;
    }

    .hero {
      grid-template-columns: 1fr;
      gap: 8px;
    }

    .intro {
      text-align: center;
    }

    h1 {
      margin-top: 20px;
      font-size: clamp(2rem, 7.5vw, 3.25rem);
    }

    .description {
      margin: 16px auto 0;
      font-size: 0.95rem;
    }

    .start {
      margin-top: 24px;
    }

    .illustration {
      width: min(100%, 420px);
      height: 300px;
      margin: 12px auto 0;
    }

    .sun {
      width: 220px;
    }

    .orbit {
      width: 270px;
    }

    .sail-note {
      right: 12px;
      bottom: 12px;
    }

    .spark-one {
      top: 16px;
      right: 20px;
    }

    .features {
      grid-template-columns: 1fr;
      gap: 12px;
      margin-top: 24px;
    }

    article {
      padding: 20px;
    }
  }
</style>
