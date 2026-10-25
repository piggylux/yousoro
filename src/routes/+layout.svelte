<script lang="ts">
  import type { LayoutProps } from './$types';
  import Header from './Header.svelte';

  import './styles.css';
  import '../app.css';

  let { data, children }: LayoutProps = $props();
</script>

<!-- Default title, overridden by pages that set their own -->
<svelte:head>
  <title>Yousoro</title>
</svelte:head>

<div class="app">
  <Header user={data.user} />

  <main>
    {@render children()}
  </main>

  <footer>
    <button onclick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>⚓</button>
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    /* Full width, so the anime grid can use wide screens; narrower content centers itself */
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  footer {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 12px;
  }

  @media (min-width: 480px) {
    footer {
      padding: 12px 0;
    }
  }
</style>
