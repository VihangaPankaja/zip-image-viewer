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

## Tooling Rule

- Always run `npm run format`, `npm run lint`, `npm run typecheck`, and `npm run build` before each major commit and before opening a PR
- If any step fails, fix the issue before committing
