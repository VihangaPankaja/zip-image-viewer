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
npm install
npm run dev
npm run lint
npm run typecheck
npm run format
npm run format:check
npm run build
npm run test
npm run test:e2e
npm start
```

## Repo Conventions

- Do not commit `node_modules/`, `dist/`, or `sessions/`
- Keep changes focused and preserve existing app structure
- Follow the current plain, minimal style unless asked for a redesign
- Bump the app version in `package.json` and `package-lock.json` before opening a PR to `master`
- For multi-step feature work, create a commit after each major implementation step
- Before each major commit, run `npm run format`, `npm run lint`, `npm run typecheck`, and `npm run build`
- Keep formatter, lint, and typecheck configurations current with repo scripts
- Keep test tooling current: Vitest for unit/component and Playwright for e2e smoke/regression

## Tooling Rule

- Always run `npm run format`, `npm run lint`, `npm run typecheck`, and `npm run build` before each major commit and before opening a PR
- Always run `npm run test` and `npm run test:e2e` before opening a PR (or document why skipped)
- Formatting is mandatory for every commit: run `npm run format` immediately before `git commit` (no exceptions)
- If any step fails, fix the issue before committing
- Never run long-lived scripts (for example `npm run dev`, `npm run dev:client`, `npm run dev:server`, or any watch mode) as a blocking foreground command in agent sessions. Use non-blocking/background patterns or explicit short timeouts for health checks so the session never hangs waiting forever.

## CI/PR Workflow Snapshot

- Existing workflow checks in `.github/workflows/`:
  - `version-check.yml` (PRs to `master`)
  - `docker-build.yml` (pushes to `master`)
- Scripts now available for local/CI enforcement:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run format:check`
  - `npm run test`
  - `npm run test:e2e`
  - `npm run build`
- Keep `package.json` and `package-lock.json` versions aligned.
