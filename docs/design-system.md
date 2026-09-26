# Transfer desk design system

The workspace is a compact utility for managing downloads and exploring media. Use clear labels, quiet neutral surfaces, and teal for the primary action and selection. Content, progress, and file previews take priority over decoration. Avoid gradients, animated backgrounds, and additional component libraries.

## Color

`client/src/styles/tokens.css` owns the palette. Consume semantic variables rather than literal colors in components.

| Token                 | Light     | Dark      | Use                       |
| --------------------- | --------- | --------- | ------------------------- |
| `--bg`                | `#f0f4f6` | `#10171d` | Page                      |
| `--bg-panel`          | `#ffffff` | `#1b2630` | Main panels and dialogs   |
| `--bg-panel-strong`   | `#ffffff` | `#22303b` | Elevated menus            |
| `--bg-inset`          | `#f5f8f9` | `#131c24` | Inputs and recessed areas |
| `--border`            | `#d4dfe5` | `#354551` | Surface dividers          |
| `--border-strong`     | `#879daa` | `#6b8292` | Strong boundaries         |
| `--text`              | `#192c38` | `#f0f5f8` | Titles and content        |
| `--text-muted`        | `#435a69` | `#bfccd5` | Supporting copy           |
| `--text-dim`          | `#526775` | `#a1b4c2` | Secondary labels          |
| `--accent`            | `#087e78` | `#5ed4c4` | Primary action            |
| `--accent-strong`     | `#06655f` | `#8be6d9` | Hover and focus           |
| `--accent-contrast`   | `#ffffff` | `#0b2322` | Text on primary buttons   |
| `--surface-highlight` | `#e0f2ee` | `#24433f` | Selection                 |
| `--accent-success`    | `#247345` | `#8ad5a6` | Completed status          |
| `--accent-danger`     | `#b52b35` | `#ff9a94` | Errors                    |

Appearance offers System, Light, and Dark. System is the default and follows OS changes while the app is open. Store an explicit preference locally. Always pair status colors with readable status text. Video and slideshow canvases stay dark to avoid distracting from media; their controls use theme tokens.

## Type, spacing, and shape

- Body uses locally available Aptos, Segoe UI Variable, then Segoe UI. Headings prefer Aptos Display. No font download is required.
- Body text is 15px with 1.5 line height. Main titles are 24px; panel titles are 16px. Supporting content generally uses 13–14px. Small labels identify metadata, never the primary action.
- Use the 4px spacing scale: 4, 8, 12, 16, 20, 24, 32, 40. Controls use 8–12px inner spacing, panels 16–24px, and settings sections 24px gaps.
- Radii are 8px for controls, 12px for panels, and 16px for dialogs. Use pills only for counts and media controls.
- Borders are 1px. Use subtle shadows for elevated panels and stronger shadows for modal surfaces.
- Buttons have a 44px minimum height. Center icons and text with flex/grid alignment and an 8px gap. Icon-only buttons remain square and need an accessible name. Disabled controls must not respond to hover.

## Layout and behavior

The page is at most 1800px wide with fluid 12–32px side padding. Desktop navigation sits between the brand and primary action. Downloads use compact rows with priority, title, status, progress, statistics, and actions. Empty downloads use a bounded panel with a clear next step instead of stretching to the bottom of the screen.

Explore uses a resizable file sidebar and preview. Sessions occupy the upper part of the sidebar. Metadata belongs below populated previews; empty previews do not reserve space for it. Truncate long file names with their full value available in a title; wrap errors and statistics so actions stay visible.

At 760px and below, or short landscape viewports up to 960px wide, navigation moves onto its own row. Explore shows one pane at a time with Files/Preview controls at the bottom. Sessions can expand within Files. Download actions wrap below their content; status labels get their own line. Preserve safe-area space around fixed mobile navigation.

Settings are a native modal dialog, up to 800px wide, with a visible close control and a sticky heading. Appearance spans the grid; downloads, preview/explorer, keyboard, and column controls use two columns. At 600px and below, settings fill the screen and use one column. Settings save automatically. Download concurrency is server-wide; appearance, sorting, and other preferences are local. Show a save failure beside the affected control.

The add-download dialog is up to 760px wide and fills a mobile viewport. Keep its queue action visible while draft entries scroll. Parse links on blur, support paste-then-submit, retain drafts on failure, and clear successful submissions. Sorting and concurrency live in Settings. Contextual playback quality remains alongside the media.

## Accessibility and verification

Use native buttons, inputs, radio groups, and dialogs. Support Escape to close, focus return, and keyboard navigation. Selected theme choices must be conveyed by radio state, not color alone. Every keyboard action has a visible focus outline. Honor reduced motion and forced colors. Keep motion limited to short color/opacity transitions.

Before changing shared styles, check both themes at 320, 375, 768, and 1440px. Run the settings/theme Playwright scenarios, including axe checks, system preference changes, persisted settings, scrolling, keyboard focus, and long transfer names/errors. Inspect screenshots as well as overflow assertions. Unit tests cover settings persistence, tree navigation, and cache lifecycle; coverage and quality gates run in CI. See `docs/quality.md` for the measured baseline and maintenance commands.
