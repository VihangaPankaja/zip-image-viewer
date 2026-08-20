# Agent Notes

## Project

- Name: `zip-image-viewer`
- Stack: `Express`, `React`, `Vite`
- Purpose: browse public ZIP archives, preview images and text files, and manage extracted sessions on the server

## Key Paths

- `server/` backend API and session handling
- `client/` frontend app
- `dist/` production frontend build output
- `sessions/` temporary extracted ZIP workspaces

## Common Commands

```bash
pnpm install --frozen-lockfile
pnpm run dev
pnpm run lint
pnpm run typecheck
pnpm run format
pnpm run format:check
pnpm run build
pnpm run test
pnpm run test:e2e
pnpm start
```

## Repo Conventions

- Do not commit `node_modules/`, `dist/`, or `sessions/`
- Keep changes focused and preserve existing app structure
- Follow the current plain, minimal style unless asked for a redesign
- Bump the app version in `package.json` before opening a PR to `master`
- For multi-step feature work, create a commit after each major implementation step
- Before each major commit, run `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm run build`
- Keep formatter, lint, and typecheck configurations current with repo scripts
- Keep test tooling current: Vitest for unit/component and Playwright for e2e smoke/regression

## Tooling Rule

- Always run `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm run build` before each major commit and before opening a PR
- Always run `pnpm run test` and `pnpm run test:e2e` before opening a PR (or document why skipped)
- Formatting is mandatory for every commit: run `pnpm run format` immediately before `git commit` (no exceptions)
- If any step fails, fix the issue before committing
- Never run long-lived scripts (for example `pnpm run dev`, `pnpm run dev:client`, `pnpm run dev:server`, or any watch mode) as a blocking foreground command in agent sessions. Use non-blocking/background patterns or explicit short timeouts for health checks so the session never hangs waiting forever.

## CI/PR Workflow Snapshot

- Existing workflow checks in `.github/workflows/`:
  - `version-check.yml` (PRs to `master`)
  - `docker-build.yml` (pushes to `master`)
- Scripts now available for local/CI enforcement:
  - `pnpm run lint`
  - `pnpm run typecheck`
  - `pnpm run format:check`
  - `pnpm run test`
  - `pnpm run test:e2e`
  - `pnpm run build`
