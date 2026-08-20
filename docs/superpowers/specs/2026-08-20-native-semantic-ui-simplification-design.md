# Native Semantic UI Simplification

## Goal

Keep the existing graphite/teal media-workspace identity while replacing unnecessary JavaScript and third-party UI machinery with semantic HTML and modern CSS. Controls must remain visually coherent: dropdown panels, dialogs, tooltips, focus states, and native video controls must not look like unrelated browser defaults.

## Principles

- Prefer deletion, native behavior, and CSS over new abstractions or dependencies.
- Preserve React only for application state, data fetching, media streaming, and actions that CSS cannot perform.
- Keep React Query, oRPC, HLS.js, and resizable desktop panels; each solves a real runtime problem.
- Add no component library or design-system dependency.
- Preserve keyboard access, visible focus, accessible names, and reduced-motion behavior.

## Component Changes

### Dropdowns and tooltips

Replace the listener-heavy dropdown with a small styled control built on the HTML Popover API. The browser supplies top-layer placement, light dismissal, and Escape handling; React only applies the selected value. The trigger, panel, options, selected state, shadow, spacing, and focus ring use the existing graphite/teal tokens, so the control never falls back to a visually unrelated menu.

Tooltips use `data-tooltip` plus CSS pseudo-elements on hover and `:focus-visible`. Every icon-only control keeps an `aria-label`; tooltip text is supplementary, not the accessible name. Pointer devices get the styled tooltip while touch users are not blocked by hover-only content.

### Files and sessions

Replace TanStack Table with a semantic `<table>` because the current view has fixed columns and precomputed rows but no library-owned sorting, filtering, pagination, or grouping. File activation moves into a real button so rows are keyboard accessible.

Replace the virtualized session rail with `<ol>` and `<li>`. The queue is intentionally bounded and does not justify virtualization or inline absolute positioning. Remove `@tanstack/react-table` and `@tanstack/react-virtual` after their imports disappear.

### Workspace navigation and structure

Use headings with `aria-labelledby` for Sessions, Files, Preview, and Details regions. Remove nested complementary landmarks. Use `<dl>` for metadata and `<fieldset>/<legend>` for settings groups.

Use native radio inputs, labels, `:checked`, and `:has()` for the mobile Sessions/Files/Preview switcher. Desktop resizing remains powered by `react-resizable-panels`; mobile pane visibility becomes CSS state instead of React state.

### Overlays and image preview

Replace portal-backed dialog-shaped `<div>` elements with native `<dialog>` elements. The browser owns the top layer, focus containment, Escape handling, and backdrop; a small effect only opens and closes the dialog from application state. Dialog surfaces use the same tokens and component styling as the workspace.

Replace JavaScript-controlled thumbnail expansion with `<details>/<summary>`. CSS styles the disclosure, expanded strip, and focus state.

### Video

Use the native `<video controls>` interface for playback, seeking, volume, speed, picture-in-picture, and fullscreen. Keep HLS.js, adaptive bitrate playback, source restoration, and quality metadata. Remove custom control state, progress-drag logic, hover thumbnails, and duplicated fullscreen handlers once unused.

Native control internals are browser-owned and cannot be fully themed consistently. The surrounding player frame, title/status overlay, quality indicator, loading state, and focus treatment remain app-styled; this is the deliberate exception to fully custom control chrome in exchange for less code and stronger platform accessibility.

## CSS Structure

Define explicit cascade layers in the stylesheet entry point: `reset`, `tokens`, `base`, `components`, and `utilities`. Tokens remain the single source for color, type, radius, spacing, borders, elevation, and motion.

Each component stylesheet owns selectors used by its component:

- `workspace.css`: shell, app bar, pane grid, session rail, mobile navigation.
- `explorer.css`: semantic file table, tree, selection and row actions.
- `preview.css`: preview stage, image frame, thumbnails, metadata and dialogs.
- `player.css`: media frame, native video element, loading and quality surfaces.
- a small controls stylesheet: dropdown popovers, tooltips, buttons, fields, and settings groups shared across components.

Delete stale selectors and fold the tiny cross-cutting responsive stylesheet into the component that owns each rule. Prefer logical properties, `clamp()`, `color-mix()`, container queries, `:has()`, `:focus-visible`, and `@media (prefers-reduced-motion)` where they replace JavaScript or duplicated breakpoints.

## Code Deletion

- Collapse the `App` -> `AppPage` -> `AppPageContainer` re-export chain to one real entry component.
- Inline the one-caller `WorkspacePresentation` wrapper when doing so reduces indirection without enlarging the caller.
- Import runtime composition directly from the server entry and remove the one-line `appRuntime` shim if existing tests confirm no lifecycle dependency.
- Reuse the existing abortable sleep helper in the segmented downloader.
- Remove state, hooks, tests, styles, and dependencies made obsolete by native table, list, details, dialog, mobile navigation, and video controls.

No new generic primitives, factories, registries, or theme runtime will be introduced.

## Verification

Update tests around user-observable behavior instead of implementation details:

- dropdown selection, Escape dismissal, and styled popover semantics;
- keyboard file activation and session selection;
- mobile pane switching through native inputs;
- dialog open/close behavior and thumbnail disclosure;
- native video controls present while adaptive HLS source selection still works;
- component accessibility with Axe and semantic role queries.

Run formatting, lint, strict type checking, unit/component/integration tests, coverage, production build, Playwright e2e, and Fallow duplication/dead-code/health checks. Render the app at desktop and mobile widths and visually inspect dropdowns, tooltips, dialogs, empty/loading/error states, files, sessions, images, and video before completion.

## Expected Result

The workspace keeps its current visual identity but has fewer UI dependencies, less event/state code, stronger semantics, and CSS that matches the markup it actually styles. The target is a net code reduction, not a parallel design system.
