# UI design

Use the existing compact layout, neutral panels and the saved accent for selection. File
content, transfer status and controls take priority over decoration.

## Styles

`client/src/styles/tokens.css` owns colors and spacing. Use semantic variables
such as `--bg-panel`, `--text` and `--accent`; do not repeat palette values in
components. `styles.css` imports the shared styles.

`vpr lint:css` rejects raw hex, named and functional colors in app styles outside
`tokens.css`, including shadows and local custom properties. Use `color-mix()`
with tokens when needed. `transparent`, `currentcolor` and system colors remain
available for transparency, inherited borders and forced-color accessibility.
Media backdrop and caption tokens keep their colors in both themes.

- Keep Light, Charcoal and AMOLED readable. System appearance follows the OS;
  `data-dark-surface` selects the saved dark palette. Dialogs and popovers inherit
  the root tokens. Use `--focus` for focus outlines.
- `data-accent` selects Teal, Blue, Violet, Amber or Rose independently of mode and
  dark surfaces. Use the shared accent, hover, contrast and selection tokens;
  keep success and error colors independent of the accent.
- Pair status color with text. Use a visible focus outline.
- Use the existing spacing scale, borders and radii.
- Keep buttons at least 44px high. Give icon-only controls accessible names.
- Use local system fonts. Keep metadata secondary to filenames and actions.

## Layout

Downloads show title, status, progress, statistics and actions. Long names may
truncate with the full value in a title; errors and statistics wrap. Actions
must remain visible.

Explore uses a resizable file sidebar and preview. On small or short landscape
screens, Files and Preview switch panes and navigation moves to its own row.
Keep controls clear of fixed navigation and device safe areas.

Settings uses a scrollable dialog with a visible close control and sticky
heading. It becomes a single-column, full-screen dialog on mobile. Settings
save automatically; show save failures beside the affected control.

Keep **Add to queue** visible while draft entries scroll. Parse links on blur,
allow paste-then-submit, retain drafts on failure and clear successful submissions.

## Interaction and review

Use native controls and dialogs. Support Escape, focus return and keyboard
navigation. Honor reduced motion and forced colors. Keep animations limited
to short color and opacity transitions.

Check both themes at narrow mobile, tablet and desktop sizes, including short
landscape layouts. Exercise scrolling, keyboard focus, long names and errors.
Run the relevant Playwright and Axe scenarios and inspect the PR gallery.
See [testing](testing.md) for commands.
