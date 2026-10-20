# Working in this repository

ZIP Image Viewer uses React, Express and TypeScript. Start with the
[development guide](docs/development/README.md) and
[source map](docs/development/architecture.md).

- Keep changes focused and follow the existing app structure and UI style.
- Validate external data through `shared/contracts.ts`. Preserve path safety,
  session ownership, cancellation and cleanup behavior.
- Keep build, lint, format, test and staged settings in `vite.config.ts`.
- Keep generated builds, caches, sessions and review media out of Git.
- Run dev servers and watch tasks in the background.
- Keep docs about current behavior. Follow [docs/AGENTS.md](docs/AGENTS.md).

## Verification and delivery

- Before each major commit, run `vpr lint`, `vpr typecheck` and `vpr build`.
  Run `vpr format` immediately before every commit. Fix failures first.
- Before opening a PR, run `vpr quality`, `vpr test` and `vpr test:e2e`.
  Preserve all suite, coverage, browser and container checks. Never lower gates
  or add skips to make a change pass.
- Verify changed flows in a real browser, including keyboard, pointer, touch
  and responsive behavior where relevant.
- For every PR, follow the [screenshot skill](.agents/skills/pr-screenshots/SKILL.md).
- Commit major steps separately. Bump `package.json` before opening a PR to `master`.
- Monitor every check on the latest PR commit. Fix failures and valid review
  findings within scope. Report blockers; do not claim unfinished work is complete.
