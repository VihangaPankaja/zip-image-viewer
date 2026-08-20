# Tooling Upgrade and Fallow Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the project compiler, package manager, and CI actions to their latest stable releases while preserving supported typed linting and eliminating Fallow-reported code duplication.

**Architecture:** TypeScript 7 is the application compiler. A small ESLint workspace owns typed-ESLint and its supported TypeScript 5.9 parser runtime instead of pretending TypeScript 7 is supported. Shared HTTP/media helpers replace repeated route plumbing, and Fallow becomes a blocking duplication/dead-code/health gate.

**Tech Stack:** TypeScript 7.0.2, typescript-eslint 8.67.0, pnpm 11.22.0, ESLint 10, Fallow 3.17.0, Vitest 4, GitHub Actions.

**Spec:** `docs/architecture.md`

## Global Constraints

- Keep strict TypeScript, typed ESLint, and the no-explicit-`any` rule enabled.
- Do not widen peer ranges or suppress unsupported-version warnings.
- Keep production files under 350 lines and functions under 80 lines.
- Preserve all public HTTP routes, response headers, and streaming semantics.
- Require frozen pnpm installs, zero Fallow dead-code findings, and a duplication threshold in CI.

---

### Task 1: Supported TypeScript 7 toolchain

**Files:**

- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/quality.yml`
- Modify: `.github/workflows/docker-build.yml`
- Modify: `.github/workflows/version-check.yml`

**Interfaces:**

- Consumes: existing strict `tsconfig.app.json`, `tsconfig.server.json`, and `tsconfig.tests.json` projects.
- Produces: TypeScript 7 application compiler plus a TypeScript 5.9 typed-ESLint peer context.

- [x] Upgrade root `typescript` to `7.0.2` and `packageManager` to `pnpm@11.22.0`.
- [x] Isolate `typescript-eslint` and TypeScript 5.9.3 in `tooling/eslint` so strict peer installation remains valid.
- [x] Regenerate the lockfile with pnpm 11.22.0 and verify `pnpm install --frozen-lockfile --strict-peer-dependencies`.
- [x] Upgrade GitHub Actions to current stable major versions and use the pinned package-manager version.
- [x] Run all strict typecheck projects and repository-wide ESLint.

### Task 2: Remove Fallow clone families

**Files:**

- Create: `server/handlers/http/requestValues.ts`
- Create: `server/handlers/http/rangeResponse.ts`
- Create: `server/handlers/video/videoRequestContext.ts`
- Modify: `server/handlers/file/fileRouteHandler.ts`
- Modify: `server/handlers/sessionJobs.ts`
- Modify: `server/handlers/video/playbackRoutes.ts`
- Modify: `server/handlers/video/routeContext.ts`
- Modify: `server/handlers/video/streamRoute.ts`
- Modify: `server/handlers/video/thumbnailRoute.ts`
- Modify: `server/handlers/videoHlsRoutes.ts`
- Modify: `server/infrastructure/process/commandRunner.ts`
- Test: existing server route, range, HLS, and integration suites.

**Interfaces:**

- Consumes: `ByteRange`, Express request/response types, `VideoRouteDependencies`, and HLS transcode entries.
- Produces: shared query parsing, validated session paths, byte-range headers, video request preparation, and child-process collection.

- [x] Extract query/error/path helpers and replace both file/video copies.
- [x] Extract byte-range response header handling and replace all three copies.
- [x] Extract video stream/thumbnail request preparation and rendition selection.
- [x] Extract HLS session/entry/quality request preparation for every HLS endpoint.
- [x] Reuse Node's child-process event promise without changing rejection behavior.
- [x] Run focused server tests, then require `fallow dupes --fail-on-issues` to report no clones.

### Task 3: Make Fallow findings actionable and blocking

**Files:**

- Modify: `client/src/components/GlobalSettingsSheet.tsx`
- Modify: `.fallowrc.json`
- Modify: `package.json`
- Modify: `.github/workflows/quality.yml`
- Modify: `README.md`

**Interfaces:**

- Consumes: the existing settings component API and Fallow coverage report.
- Produces: narrow child-component prop contracts and repeatable dead-code, duplication, and health gates.

- [x] Narrow each settings subcomponent to only the props it consumes so Fallow does not report false unused props.
- [x] Set a strict duplication threshold and enable type-aware Fallow analysis for all TypeScript projects.
- [x] Add duplication and coverage-gap reporting scripts and run them in CI.
- [x] Run Fallow dead-code, duplicates, health, targets, and coverage-gap analyses; fix remaining actionable findings in changed code.
- [x] Update tooling documentation and run format, lint, types, tests, coverage, builds, E2E, audit, and frozen-install verification.
