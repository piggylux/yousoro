<script lang="ts">
  import SignInButton from '#lib/components/SignInButton.svelte';
  import YouSvg from '#lib/images/minimalist_you.svg';
</script>

<div class="home">
  <section class="hero" aria-labelledby="welcome-title">
    <div class="intro">
      <p class="eyebrow">An AniList companion</p>
      <h1 id="welcome-title">Keep up with<br />what you watch.</h1>
      <p class="description">
        See what’s aired, keep your AniList progress up to date, and find the shows you’re watching
        with friends.
      </p>
      <div class="start">
        <SignInButton redirectTo="/home" />
        <p class="sign-in-hint">Sign in with your existing AniList account.</p>
      </div>
    </div>

    <figure class="illustration">
      <img src={YouSvg} alt="" fetchpriority="high" />
      <figcaption>Inspired by You Watanabe.</figcaption>
    </figure>
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
      <h2>Plan your week</h2>
      <p>See upcoming episodes in your local time zone.</p>
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
      <h2>Pick up where you left off</h2>
      <p>Find unwatched episodes and save your progress to AniList.</p>
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
          <circle cx="9" cy="8" r="3" />
          <path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m3 10v-2a6 6 0 0 0-2-4" />
        </svg>
      </span>
      <h2>Watch alongside friends</h2>
      <p>Find the shows you share and see everyone’s episode progress.</p>
    </article>
  </section>
  <p class="sign-off">Yousoro · An independent AniList companion.</p>
</div>

<style>
  .home {
    width: min(100%, 1120px);
    margin: 24px auto 0;
    padding: 24px 16px 0;
    color: var(--text-heading);
  }

  .hero {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    align-items: center;
    gap: 48px;
    min-height: 360px;
  }

  .intro {
    position: relative;
    z-index: 1;
  }

  .eyebrow {
    color: var(--text-accent);
    font-size: 0.875rem;
    font-weight: 500;
  }

  h1 {
    margin-top: 16px;
    font-size: clamp(2.25rem, 4.3vw, 3.5rem);
    font-weight: 650;
    line-height: 1.1;
    letter-spacing: -0.04em;
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
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    place-items: center;
    min-width: 0;
    height: 360px;
    margin: 0;
    padding: 24px 24px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--you-blue-pale);
  }

  .illustration img {
    width: 100%;
    height: 100%;
    min-height: 0;
    object-fit: contain;
    user-select: none;
    max-width: 380px;
  }

  figcaption {
    margin-top: 12px;
    color: var(--text-accent);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .features {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 32px;
    margin-top: 32px;
    padding-top: 28px;
    border-top: 1px solid var(--border-subtle);
  }

  .feature-icon {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    color: var(--you-blue);
  }

  .feature-icon svg {
    width: 22px;
    height: 22px;
  }

  h2 {
    margin-top: 16px;
    font-size: 1rem;
    font-weight: 600;
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
    text-align: left;
  }

  @media (max-width: 760px) {
    .home {
      margin-top: 0;
      padding: 16px 0 0;
    }

    .hero {
      grid-template-columns: 1fr;
      gap: 24px;
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
      width: min(100%, 360px);
      height: 280px;
      margin: 12px auto 0;
    }

    .features {
      grid-template-columns: 1fr;
      gap: 28px;
      margin-top: 24px;
    }
  }
</style>
