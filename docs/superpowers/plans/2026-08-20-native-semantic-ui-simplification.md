# Native Semantic UI Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the media workspace to semantic HTML and modern CSS while preserving its graphite/teal visual identity and adaptive media behavior.

**Architecture:** Native tables, lists, disclosure widgets, dialogs, media controls, radio state, and popovers replace library or listener-heavy UI code. React remains responsible for application state and network/media orchestration; cascade layers and component-owned CSS supply the visual system.

**Tech Stack:** React 19, TypeScript 7, CSS cascade layers, HTML Popover/Dialog/Details APIs, Vitest, Testing Library, Axe, Playwright, Fallow.

**Spec:** `docs/superpowers/specs/2026-08-20-native-semantic-ui-simplification-design.md`

## Global Constraints

- Keep React Query, oRPC, HLS.js, and `react-resizable-panels`.
- Add no UI or design-system dependency.
- Preserve keyboard access, visible focus, accessible names, and reduced-motion behavior.
- Keep dropdown panes, dialogs, and tooltips visually consistent with the existing graphite/teal theme.
- Use native video controls while retaining adaptive HLS source selection.
- Make one implementation commit after the required major version bump, per the user's instruction.

---

### Task 1: Semantic files, sessions, and mobile panes

**Files:**

- Modify: `client/src/components/Workspace/SessionRail.test.tsx`
- Modify: `client/src/components/Workspace/SessionRail.tsx`
- Create: `client/src/components/ExplorerTablePanel.test.tsx`
- Modify: `client/src/components/ExplorerTablePanel.tsx`
- Modify: `client/src/features/workspace/components/WorkspaceLayout.test.tsx`
- Modify: `client/src/features/workspace/components/WorkspaceLayout.tsx`

**Interfaces:**

- Consumes: existing `SessionRailItem`, `ExplorerTablePanelProps`, and `WorkspaceLayoutProps`.
- Produces: semantic list/table/radio markup with unchanged callback contracts.

- [ ] **Step 1: Add failing behavior tests**

```tsx
expect(screen.getByRole("list", { name: "Sessions" })).toBeVisible();
await user.click(screen.getByRole("button", { name: /open .*\.jpg/i }));
expect(setSelectedPath).toHaveBeenCalledWith("photos/example.jpg");
await user.click(screen.getByRole("radio", { name: "Files" }));
expect(screen.getByRole("radio", { name: "Files" })).toBeChecked();
```

- [ ] **Step 2: Run the focused tests and confirm each new assertion fails because the old virtual list, clickable row, or button navigation remains**

Run: `pnpm exec vitest run --configLoader runner --project component client/src/components/Workspace/SessionRail.test.tsx client/src/components/ExplorerTablePanel.test.tsx client/src/features/workspace/components/WorkspaceLayout.test.tsx`

- [ ] **Step 3: Replace the implementations with native structures**

```tsx
<ol className="session-list" aria-label="Sessions">
  {sessions.map((session) => (
    <li key={session.id}><button aria-current={session.id === activeId ? "true" : undefined}>…</button></li>
  ))}
</ol>

<table className="explorer-table"><thead>…</thead><tbody>{explorerRows.map((row) => <tr key={row.path}>…</tr>)}</tbody></table>

<input className="workspace-pane-control" type="radio" name="workspace-pane" id="workspace-pane-files" defaultChecked={false} />
<label htmlFor="workspace-pane-files">Files</label>
```

Render optional cells directly from `explorerColumns`; put file selection on the Name button and mark it with `aria-current`. Remove TanStack imports, virtual positioning, and React mobile-pane state.

- [ ] **Step 4: Run the focused tests until green**

Run the Step 2 command; expected result: all listed files pass with no warnings.

### Task 2: Styled popovers, dialogs, disclosures, and semantic settings

**Files:**

- Create: `client/src/components/Common/CustomDropdown.test.tsx`
- Modify: `client/src/components/Common/CustomDropdown.tsx`
- Modify: `client/src/components/GlobalSettingsSheet.tsx`
- Modify: `client/src/components/Preview/ImagePreviewContent.tsx`
- Modify: `client/src/features/workspace/components/WorkspaceOverlays.tsx`
- Modify: `client/src/features/workspace/useWorkspacePageEffects.ts`
- Modify: `client/src/features/workspace/useWorkspacePageState.ts`
- Modify: `client/src/features/workspace/types.ts`

**Interfaces:**

- Consumes: existing dropdown value/callback contract and workspace open/close callbacks.
- Produces: `popover="auto"`, `<dialog>`, `<details>`, `<fieldset>`, and `<dl>` markup without global dismissal listeners or portal overlays.

- [ ] **Step 1: Add failing dropdown and disclosure tests**

```tsx
expect(screen.getByRole("button", { name: "Quality" })).toHaveAttribute(
  "popovertarget",
);
expect(screen.getByRole("listbox", { name: "Quality" })).toHaveAttribute(
  "popover",
  "auto",
);
expect(
  screen.getByText("Folder thumbnails").closest("details"),
).toBeInTheDocument();
```

- [ ] **Step 2: Run focused component tests and verify red**

Run: `pnpm exec vitest run --configLoader runner --project component client/src/components/Common/CustomDropdown.test.tsx client/src/components/Preview client/src/features/workspace/components/WorkspaceLayout.test.tsx`

- [ ] **Step 3: Implement the minimum native markup**

```tsx
<button id={id} popoverTarget={menuId} aria-label={label}>…</button>
<div id={menuId} popover="auto" role="listbox" aria-label={label}>…</div>

<dialog ref={dialogRef} onCancel={close} onClose={close}>…</dialog>

<details className="thumbnail-strip-shell"><summary>Folder thumbnails</summary>…</details>

<fieldset className="settings-group"><legend>Downloads</legend>…</fieldset>
```

Use `showModal()`/`close()` only to synchronize dialog state. Use `hidePopover()` after selection. Remove global `mousedown`/`keydown` listeners, portal mounting, thumbnail expansion state, and body-scroll locking that native top-layer elements replace.

- [ ] **Step 4: Run focused component tests until green**

Run the Step 2 command; expected result: all listed files pass.

### Task 3: Native video controls with adaptive streaming intact

**Files:**

- Modify: `client/src/components/Preview/VideoPreviewContent.test.tsx`
- Modify: `client/src/components/Preview/VideoPreviewContent.tsx`
- Modify: `client/src/hooks/useVideoPlaybackController.ts`
- Modify: `client/src/features/player/useVideoControls.ts`
- Delete if unused: `client/src/features/player/useVideoSeekPreview.ts`
- Modify: `client/src/features/workspace/types.ts`
- Modify callers that pass removed custom-control props.

**Interfaces:**

- Consumes: `videoRef`, HLS source URL, quality options, playback error, selected quality, and source-restoration state.
- Produces: `<video controls>` with the same adaptive-quality dropdown and error/status surfaces.

- [ ] **Step 1: Replace the custom-seek assertion with a failing native-controls assertion**

```tsx
const video = screen.getByLabelText("Video preview");
expect(video).toHaveAttribute("controls");
expect(video).toHaveAttribute("playsinline");
expect(
  screen.queryByRole("slider", { name: "Seek video" }),
).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the video component and player tests and verify red**

Run: `pnpm exec vitest run --configLoader runner client/src/components/Preview/VideoPreviewContent.test.tsx client/src/features/player`

- [ ] **Step 3: Render native controls and delete obsolete controller state**

```tsx
<video
  ref={videoRef}
  aria-label="Video preview"
  className="video-player"
  controls
  playsInline
  preload="metadata"
>
  Your browser cannot play this video inline.
</video>
```

Keep HLS loading, source restoration, quality selection, and keyboard shortcuts only where they remain additive. Delete progress dragging, hover-preview, duplicate play/volume/rate/fullscreen UI state, and their props after TypeScript identifies every caller.

- [ ] **Step 4: Run the Step 2 tests until green, then strict client typecheck**

Run: `pnpm run typecheck:client`

### Task 4: Component-owned graphite/teal CSS

**Files:**

- Modify: `client/src/styles.css`
- Modify: `client/src/styles/tokens.css`
- Modify: `client/src/styles/foundation.css`
- Create: `client/src/styles/controls.css`
- Modify: `client/src/styles/workspace.css`
- Modify: `client/src/styles/explorer.css`
- Modify: `client/src/styles/preview.css`
- Modify: `client/src/styles/player.css`
- Delete: `client/src/styles/responsive.css`

**Interfaces:**

- Consumes: the semantic class names introduced in Tasks 1-3.
- Produces: layered, responsive, reduced-motion-aware styling with no stale selectors.

- [ ] **Step 1: Establish cascade layers and shared control styling**

```css
@layer reset, tokens, base, components, utilities;
@import "./styles/tokens.css" layer(tokens);
@import "./styles/foundation.css" layer(base);
@import "./styles/controls.css" layer(components);
```

Style `[popover]`, `.custom-dropdown-trigger`, `.custom-dropdown-option`, `[data-tooltip]`, `dialog`, fields, toggles, and focus rings with existing tokens plus `color-mix()`.

- [ ] **Step 2: Align each component stylesheet with current markup**

Use logical properties, `clamp()`, `container-type`, `content-visibility`, `:has()`, and `:focus-visible`. Style session states, selected rows, thumbnail disclosure, image/video frames, metadata, loading/error states, mobile radio labels, resizers, popover open transitions, and dialog backdrops. Move mobile rules into owning component styles and delete `responsive.css`.

- [ ] **Step 3: Add reduced-motion and forced-colors fallbacks**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto;
    transition-duration: 0.01ms !important;
  }
}
@media (forced-colors: active) {
  :focus-visible {
    outline: 2px solid CanvasText;
  }
}
```

- [ ] **Step 4: Build and render desktop/mobile views**

Run: `pnpm run build:client`

Inspect the workspace at desktop and mobile widths, including dropdown, tooltip, settings, slideshow, files, sessions, image, video, empty, loading, and error states. Fix visual mismatches in the owning stylesheet.

### Task 5: Remove indirection, dependencies, and duplication

**Files:**

- Modify: `client/src/App.tsx`
- Delete: `client/src/pages/AppPage.tsx`
- Delete: `client/src/pages/AppPageContainer.tsx`
- Modify: `client/src/features/workspace/components/WorkspacePageView.tsx`
- Delete: `client/src/features/workspace/components/WorkspacePresentation.tsx`
- Modify: `server/index.ts`
- Delete: `server/appRuntime.ts`
- Modify: `server/services/segmentedDownloader.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: existing `useWorkspacePageController`, `WorkspaceLayout`, runtime composition side effect, and exported `sleepWithSignal`.
- Produces: one app entry, direct runtime import, two fewer TanStack packages, and package version `3.0.0`.

- [ ] **Step 1: Collapse one-caller wrappers and reuse existing helpers**

```tsx
export default function App() {
  return <WorkspacePageView controller={useWorkspacePageController()} />;
}
```

Import `./runtimeComposition.js` directly in `server/index.ts`. Import `sleepWithSignal` from `server/infrastructure/runtime/mediaClassification.ts` and delete the local duplicate.

- [ ] **Step 2: Remove unused dependencies and bump the major version**

Run: `pnpm remove @tanstack/react-table @tanstack/react-virtual`

Set `package.json` version from `2.0.0` to `3.0.0` and refresh the lockfile.

- [ ] **Step 3: Run the complete verification gate**

Run, in order:

```text
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:coverage
pnpm run fallow:dead
pnpm run fallow:duplicates
pnpm run fallow:health
pnpm run build
pnpm run test:e2e
```

Expected: every command exits zero; Vitest and Playwright report zero failures; Fallow reports no dead code or duplicates and meets its configured health score.

- [ ] **Step 4: Review the final diff against the spec, commit once, push, and open the PR against `master`**

Immediately before the commit, rerun `pnpm run format`. Commit message: `feat!: simplify workspace with native semantic UI`. Push `codex/modernize-workspace-v2` and create a PR whose body includes the major-version note, code reduction, dependency removals, adaptive HLS preservation, tests, coverage, Fallow results, and visual/accessibility verification.
