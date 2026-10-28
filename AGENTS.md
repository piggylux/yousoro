# Contributor instructions

These instructions apply throughout this repository. Keep contributor rules and design conventions
here; keep `README.md` focused on the product and getting started.

## Engineering approach

- Challenge architecture choices when there is a concrete production concern. Explain the tradeoff
  and recommend the simplest sound solution instead of agreeing automatically.
- Avoid over-engineering. Reuse existing components and patterns before introducing abstractions,
  dependencies, or frameworks.
- Preserve unrelated work in the working tree.

## Stack and styling

- This app uses Svelte 5, SvelteKit, TypeScript, Bun, Tailwind CSS, and daisyUI.
- Use the existing Svelte patterns and `#lib/*` imports. Tailwind and daisyUI classes use the `tw:`
  prefix; component styles remain unprefixed and live beside their markup.
- Shared colors, radii, dialog spacing, and overlay shadows live in `src/app.css`. Global typography
  and keyboard focus styles live in `src/routes/styles.css`.
- Change shared tokens or components when fixing a shared inconsistency. Avoid copying local
  variants of the same control into individual pages or dialogs.
- Prefer the existing stack and dependencies when they meet the need. Justify additions with a
  concrete benefit and account for their maintenance cost.

## Visual direction

- Keep the app clean, professional, friendly, and engaging for anime fans.
- Let anime covers, existing character artwork, and shared watching activity provide personality.
  Use clear, welcoming copy rather than generic promotional language.
- Keep page surfaces neutral and reserve blue for actions and selection. Pair status colors with
  text or an icon; never rely on color alone.
- Prefer clear hierarchy, consistent spacing, and subtle borders over gradients, floating
  decorations, excessive pill shapes, or stacked shadows.
- Use `--radius-control` for controls and `--radius-panel` for panels. Treat the shared CSS tokens
  as the source of truth rather than copying their current values into components. Avoid local
  palettes, shadows, or typography treatments for equivalent elements.
- Check every visual change in both light and dark themes.

## Cards and responsive layouts

- Keep badges in the dedicated, centered `.card-status` row on both card faces. Keep them in normal
  flow so they cannot overlap titles, artwork, or actions.
- Preserve a consistent order and alignment for equivalent fields and actions across cards.
- On mobile, compact card backs use stacked primary fields and controls at least 44px high. Keep
  optional metadata in the existing details disclosure rather than changing the primary layout per card.
- Reuse `ScoreInput.svelte` for scores, including all supported score formats and the unscored state.
- Handle long titles, names, labels, and missing data without horizontal overflow or overlapping
  controls. Allow text wrapping and use truncation only where space is deliberately constrained.

## Dialogs and dismiss controls

- Use `src/lib/components/CloseButton.svelte` for icon dismiss controls, including dialog close
  buttons and dismissible notifications. Do not create local cross glyphs or button variants.
- Let `CloseButton.svelte` own its icon, target size, hover/active styles, and visible keyboard focus.
  Supply a descriptive accessible label for the surface being closed; do not override its geometry
  or interaction styles per consumer.
- Use `--dialog-padding` for dialog header insets and its shared responsive adjustment.
- Put the close control at the top right in the header, with space reserved for it beside wrapped
  headings. Keep the header visible while the dialog body scrolls, including on short screens.
- Preserve native modal behavior: accessible dialog names, focus containment, Escape dismissal,
  and focus return to the opener. Choose useful initial focus when a dialog has a primary input.
- Preserve existing backdrop-dismiss behavior and avoid accidental dismissal from content clicks
  or drags that start inside the dialog.

## Accessibility and verification

- Use semantic links, buttons, labels, and headings. Give icon-only controls accessible names.
- Preserve the skip link, visible keyboard focus, readable contrast, and reduced-motion behavior.
- Keep touch controls comfortably usable; close controls and mobile card actions need targets
  at least 44px in each dimension. Allow controls to grow for text sizing and content.
- For UI changes, inspect the affected components and their shared consumers in the browser at
  narrow mobile and desktop widths. Include long content, empty states, and short viewport heights
  where relevant. Check keyboard access, focus return, scrolling, and both themes.
- Format changed files with `bunx oxfmt <paths>`; `bun run format` formats the whole repository.
  Avoid incidental formatting changes to unrelated files.
- For code changes, run `bun run lint`, `bun run check`, and `bun run build`, plus
  `bun run test --run` when behavior or shared logic is affected. Review the final diff and run
  `git diff --check` before finishing.
- Add tests for meaningful behavior changes; avoid tests that merely mirror CSS or low-impact
  presentational edits. For documentation-only changes, check formatting with
  `bunx oxfmt --check <paths>` and run `git diff --check`; a full build is unnecessary.
