# ZIP Image Viewer 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a Node 26/pnpm, strictly typed, modular ZIP media workspace with concurrent downloads, adaptive video, a professional UI, and comprehensive automated quality gates.

**Architecture:** Keep trusted self-hosted sessions ephemeral. Use oRPC and Zod for the typed control plane, typed Express routes for binary media, layered server ports/adapters, feature-oriented React modules, and TanStack Query/Router/Table/Virtual for remote state and workspace navigation.

**Tech Stack:** Node 26.7.0, pnpm 11.21.0, React 19, Express 5, TypeScript 5.9, oRPC, Zod 4, TanStack, HLS.js, Vitest, Playwright, Fallow, ESLint, Prettier, Lefthook.

## Global Constraints

- Branch from `origin/master` as `codex/modernize-workspace-v2` and release as `2.0.0`.
- No explicit or implicit `any`, `@ts-nocheck`, unsafe JSON casts, or broad lint suppressions in source or tests.
- Production source files stay under 350 logical lines and functions under 80 lines; generated files are the only exception.
- Downloads and sessions are ephemeral; run at most two downloads and two FFmpeg processes concurrently.
- The UI is a unified professional file studio, not a marketing page: no glassmorphism, glow backgrounds, decorative grids, or oversized hero.
- Global coverage is at least 85% statements/lines/functions and 80% branches; critical contracts, path safety, queue, extraction, and streaming helpers are at least 95% statements/lines/functions and 90% branches.
- Use TDD for each behavior and run format, lint, typecheck, relevant tests, and build before each major commit.

---

### Task 1: Runtime and quality foundation

- [ ] Pin Node 26.7.0 and pnpm 11.21.0, replace npm lock/install flows, update Docker and CI.
- [ ] Upgrade to current compatible dependencies; keep TypeScript 5.9 until typed-eslint supports 7; remove unused packages.
- [ ] Repair the Vitest localStorage environment and Playwright web-server setup.
- [ ] Enable strict TypeScript/type-aware ESLint, Fallow boundaries/health/audit, Lefthook, and coverage scripts.
- [ ] Verify the foundation and commit `chore(tooling): adopt Node 26 and pnpm quality gates`.

### Task 2: Typed contracts and modular server

- [ ] Write failing domain and contract tests for jobs, sessions, validation, path safety, queue state, and typed errors.
- [ ] Add shared Zod/oRPC contracts and typed media query/URL schemas.
- [ ] Split runtimeComposition into domain, application ports/use cases, infrastructure adapters, HTTP adapters, and bootstrap.
- [ ] Export a side-effect-free `createApp()` and keep startup/shutdown in a minimal entrypoint.
- [ ] Remove all server type suppressions, validate environment values, and enforce URL/redirect/archive/process safety.
- [ ] Verify and commit `refactor(server): introduce typed application boundaries`.

### Task 3: Multi-download application model

- [ ] Write failing queue tests for 1-50 URLs, two concurrent jobs, cancellation, retry, confirmation, cleanup, and typed events.
- [ ] Implement ephemeral typed job/session repositories and a two-worker queue.
- [ ] Add oRPC enqueue/list/cancel/retry and session list/tree/remove procedures plus typed progress subscription.
- [ ] Migrate client remote state to TanStack Query and route state to TanStack Router.
- [ ] Support newline batch paste and browsing ready sessions while other downloads continue.
- [ ] Verify and commit `feat(workspace): add typed multi-download sessions`.

### Task 4: Professional unified workspace

- [ ] Write component tests for the queue rail, session switching, file navigation, preview persistence, responsive navigation, and keyboard behavior.
- [ ] Replace Download/Preview/Explorer tabs with a full-height app bar, resizable session rail, virtualized explorer, preview, and metadata drawer.
- [ ] Adopt TanStack Table/Virtual for large trees and file lists.
- [ ] Replace monolithic CSS with tokens/foundations/workspace/explorer/preview/player/responsive modules using a graphite/teal professional file-studio system.
- [ ] Add accessible empty/loading/error/confirmation states and mobile Sessions/Files/Preview navigation.
- [ ] Verify and commit `feat(ui): redesign the unified media workspace`.

### Task 5: Adaptive streaming and modern player

- [ ] Write failing tests for rendition calculation, master/variant playlists, aligned segment state, process limits, cancellation, and quality switching.
- [ ] Produce a lazy multi-variant four-second fMP4 HLS ladder, remux compatible sources, transcode others, and cache per session.
- [ ] Dynamically import HLS.js and enable Auto ABR, player-size and FPS capping, retry recovery, and a 30-second buffer.
- [ ] Build accessible play, seek thumbnail, time, volume, speed, Auto/manual quality, PiP, fullscreen, responsive, and keyboard controls without losing playback position.
- [ ] Verify and commit `feat(video): add adaptive HLS playback`.

### Task 6: Complete test and delivery gates

- [ ] Add unit, React component, Supertest/oRPC integration, real ZIP/FFmpeg fixture, Playwright visual/accessibility, and end-to-end suites.
- [ ] Cover batch concurrency, browse-during-download, cancellation/retry, all preview types, HLS bandwidth adaptation, expiry, malformed inputs, Range seeking, and mobile navigation.
- [ ] Enforce the global and critical-module coverage thresholds and publish LCOV/HTML artifacts.
- [ ] Run Chromium on PRs and Chromium/Firefox/WebKit on master/nightly; publish Fallow SARIF.
- [ ] Update README and architecture docs, bump to 2.0.0, run the complete quality/Docker matrix, and commit `chore(release): finalize ZIP Image Viewer 2.0`.
