<script lang="ts">
  import { SCORE_SCALES, scoreChoices, type ScoreFormat } from '#lib/score.js';

  type Props = {
    /** The list owner's AniList score format, which the field follows */
    format: ScoreFormat;
    /** The score being edited; null while a number field is empty, which means no score */
    value: number | null;
    /** What the field is for, for screen readers */
    label: string;
    /** The id of the form the field belongs to, when it sits outside it */
    form?: string;
    /** Small on a card, large where the score is the one thing being asked */
    size?: 'small' | 'large';
  };

  let { format, value = $bindable(), label, form, size = 'small' }: Props = $props();

  const choices = $derived(scoreChoices(format));
  const scale = $derived(SCORE_SCALES[format]);
</script>

<!--
  Sent as "score", in the format's own scale: a choice of stars or smileys for the formats with only
  a few scores, a number field for the others. 0 means no score. `form` ties the field to a form it
  sits outside of
-->
<span class="score-input" class:large={size === 'large'}>
  {#if choices}
    <select
      class="score-choice tw:select"
      class:tw:select-xs={size === 'small'}
      class:tw:select-md={size === 'large'}
      name="score"
      {form}
      bind:value
      aria-label={label}
    >
      {#each choices as choice (choice.value)}
        <option value={choice.value}>{choice.label}</option>
      {/each}
    </select>
  {:else}
    <input
      class="score-number tw:input"
      class:tw:input-xs={size === 'small'}
      class:tw:input-md={size === 'large'}
      type="number"
      name="score"
      {form}
      min="0"
      max={scale.max}
      step={scale.step}
      placeholder="–"
      bind:value
      aria-label={label}
    />
    <span class="scale">/ {scale.max}</span>
  {/if}
</span>

<style>
  .score-input {
    display: inline-flex;
    align-items: center;
    gap: var(--score-control-gap, 6px);
    max-width: 100%;
  }

  /* At most as wide as the room there is; a long choice is cut short rather than overflow */
  .score-choice {
    width: auto;
    min-width: 0;
    max-width: min(9rem, 100%);
  }

  .score-number {
    width: var(--score-number-width, 4rem);
  }

  .scale {
    white-space: nowrap;
  }

  @media (max-width: 767px) {
    .score-number,
    .score-choice {
      min-height: var(--score-control-height, 36px);
      font-size: var(--score-control-font-size, 1rem);
    }
  }

  /* Large: easy to read and to tap, with the scale beside it at the same size */
  .large {
    gap: 10px;
  }

  .large .score-choice {
    max-width: none;
  }

  .large .score-number {
    width: 5.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    text-align: center;
  }

  /* The prompt focuses its field as it opens, so the ring is the app's soft blue, not black */
  .large .score-number:focus,
  .large .score-choice:focus {
    outline: 2px solid var(--you-blue);
    outline-offset: 2px;
  }

  .large .scale {
    font-size: 1.15rem;
    font-weight: 600;
  }
</style>
