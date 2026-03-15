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
npm run build
npm start
```

## Repo Conventions

- Do not commit `node_modules/`, `dist/`, or `sessions/`
- Keep changes focused and preserve existing app structure
- Follow the current plain, minimal style unless asked for a redesign
