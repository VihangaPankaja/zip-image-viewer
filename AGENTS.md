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
  Preserve all suite, coverage, browser and container checks. Do not lower
  acceptance limits or add skips to make a change pass. Fallow's aggregate
  health score is advisory; actionable code and dependency findings remain gated.
- Verify changed flows in a real browser, including keyboard, pointer, touch
  and responsive behavior where relevant.
- For PRs with visible UI changes, follow the
  [screenshot skill](.agents/skills/pr-screenshots/SKILL.md). Include backend changes
  that affect displayed content, states or interactions; skip screenshots when
  there is no visible effect. Capture affected areas in dark mode by default;
  include all affected themes, surfaces and accents only for color/theme changes.
  Embed the screenshots in the PR description using GitHub attachments, then
  verify that every image renders in the saved description. Local paths and
  comments about captured images do not satisfy this requirement. If upload is
  blocked, keep the UI delivery unfinished and report the exact blocker and
  capture paths; do not present the PR as complete or ready to merge. Keep
  screenshot capture out of CI, package scripts and releases.
- Commit major steps separately. Bump `package.json` before opening a PR to `master`.
- Label PRs from their title and description with one type (`bug`, `enhancement`,
  `documentation`, `refactor` or `maintenance`) and up to two areas (`downloads`,
  `archives-files`, `media-player`, `interface`, `tooling-ci` or `security`).
  Preserve unrelated labels on normal PRs. Formal reverts get only `revert`;
  keep Dependabot's existing labels.
- Monitor every check on the latest PR commit. Fix failures and valid review
  findings within scope. Report blockers; do not claim unfinished work is complete.
