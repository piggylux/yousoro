<script lang="ts">
  type Props = {
    /** What the text is for, naming the field and its Copy button */
    label: string;
    value: string;
  };

  let { label, value }: Props = $props();
  const id = $props.id();

  // Feedback once the text is copied or couldn't be, shown on the button for a moment
  let copied = $state<'copied' | 'failed' | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));

  let field = $state<HTMLInputElement>();

  async function copy() {
    clearTimeout(timer);
    copied = null;
    try {
      await navigator.clipboard.writeText(value);
      copied = 'copied';
    } catch {
      // Selected instead, so it can still be copied by hand
      field?.select();
      copied = 'failed';
    }
    timer = setTimeout(() => (copied = null), 2500);
  }
</script>

<div class="copy-field">
  <label for={id}>{label}</label>
  <div class="copy-row">
    <input
      bind:this={field}
      {id}
      class="tw:input"
      readonly
      {value}
      spellcheck="false"
      onfocus={(event) => event.currentTarget.select()}
    />
    <button type="button" class="tw:btn" onclick={copy}>
      {copied === 'copied' ? 'Copied' : copied === 'failed' ? "Couldn't copy" : 'Copy'}<span
        class="tw:sr-only">&nbsp;{label}</span
      >
    </button>
  </div>
  <span class="tw:sr-only" role="status">
    {copied === 'copied'
      ? `${label} copied`
      : copied === 'failed'
        ? 'Select the text to copy it'
        : ''}
  </span>
</div>

<style>
  label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-heading);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .copy-row {
    display: flex;
    gap: 8px;
  }

  input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
  }

  button {
    flex: none;
    min-width: 6.5rem;
    min-height: 44px;
  }
</style>
