# Staged Vite+ baseline

Roadmap task B01, recorded on 2026-10-20. The rollback point is
`e0b234c`, before this migration. B02 owns configuration consolidation and
the remaining CLI scripts; B03 owns the lint rule parity review. This stage
installs and exercises the target toolchain while preserving the existing
ESLint, Prettier, Lefthook, TypeScript server build and separate Vitest projects.

## Release selection

The npm registry's stable `vite-plus` release was **1.3.0**, not a preview.
Its supported Node range is `^22.18.0 || ^24.11.0 || >=26.0.0`.
The repository keeps Node **26.7.0** and pnpm **12.1.0**. The migrator moved
the Node pin from `.nvmrc` to `.node-version`; CI and setup instructions
use the new filename.

The exact catalog entries in `pnpm-workspace.yaml` are:

| Package               | Before  | Staged target                                                  |
| --------------------- | ------- | -------------------------------------------------------------- |
| `vite-plus`           | Absent  | `1.3.0`                                                        |
| `vite`                | `8.2.2` | `npm:@voidzero-dev/vite-plus-core@1.3.0`, bundles Vite `8.3.4` |
| `vitest`              | `5.0.0` | `5.0.5`                                                        |
| `@vitest/coverage-v8` | `5.0.0` | `5.0.5`                                                        |

`pnpm exec vp toolchain` also reports Rolldown `1.2.14`, tsdown `0.23.1`,
Oxlint `1.88.0`, oxlint-tsgolint `7.0.2004` and Oxfmt `0.73.0`.
The latter tools are bundled dependencies, not replacements for the current
lint/format gates. No canary versions or runtime dependency upgrades were needed.
The original lockfile was used when resolving the staged graph to avoid
refreshing unrelated dependency ranges.

## Reproduce the migration

From the workspace root, with the original dependencies still installed:

```sh
pnpm install --frozen-lockfile
pnpm dlx --package=vite-plus@1.3.0 vp help
pnpm dlx --package=vite-plus@1.3.0 vp help migrate
pnpm dlx --package=vite-plus@1.3.0 vp migrate --no-interactive --no-agent --no-editor --no-hooks
```

The target CLI runs through pnpm. Contributors do not need a global `vp`,
Oxlint, Oxfmt or TypeScript installation. The migrator may bootstrap its own
copy of the declared package manager; this is not a project prerequisite.
After reviewing the generated changes, retain the staged decisions below and
run `pnpm install`. Subsequent clean installs use `--frozen-lockfile`.

Sources checked at implementation time:
[migration](https://viteplus.dev/guide/migrate),
[dependency and rewrite rules](https://viteplus.dev/guide/migrate-rules), and
[Vitest 5 compatibility](https://viteplus.dev/guide/vitest-v5).

## Migration findings and decisions

- No blocking preflight findings. Vite 8 and Vitest 5 already satisfy the
  Vite 7+/Vitest 4+ prerequisites. No generated v4 compatibility settings
  or tsdown compatibility settings were added.
- Two asynchronous-assertion review findings were checked manually.
  `useImagePreviewCache.test.tsx` saves the assertion in `failure` and awaits it
  after rejecting the pending fetch. `torrentDownloader.test.ts` saves the
  assertion in `duplicate` inside `onMetadata` and awaits it after the download.
  Both already preserve the intended rejection checks.
- The generated ESLint replacement skipped `no-dupe-args`, `no-octal`,
  `react-hooks/config` and `react-hooks/gating`. The complete existing ESLint
  config, workspace package, inline exceptions and fatal-warning script were
  restored. No rule was dropped. B03 must evaluate these mappings explicitly.
- The migrator reported Prettier without a root config and requested manual
  migration. Prettier remains the sole formatter, including in Lefthook and CI.
  The empty generated `fmt` block and generated Oxlint block were not retained.
- The existing Lefthook configuration remains in charge of commits and pushes.
  The migration was run with `--no-hooks`, `--no-agent` and `--no-editor`.
- The catalog and `vite@*`/`vitest@*` overrides keep the dependency graph on
  one compatible core and runner. Generated peer rules allow Vite consumers
  to accept the core package's alias version. Direct `vitest` remains necessary
  for `vitest/globals` and jest-dom's upstream type augmentation.
- Config/test imports use the supported `vite-plus`/`vite-plus/test` entries.
  The existing test projects, test filters, runner loader and Node webstorage
  workaround remain. There are no new skips or threshold changes.
- Dev/client build commands use local `vp`. Playwright's two hard-coded
  `node_modules/vite/bin/vite.js` launchers now invoke `vite-plus/bin/vp dev`;
  the aliased core does not ship the old executable path. The benchmark's
  programmatic `vite` import continues to resolve through the core alias.
- The server still compiles with `tsc`; Docker still copies the complete
  `build` tree. All coverage, Fallow, browser, gallery, benchmark and image
  checks remain enabled. CI adds clean Windows and Linux install/type/build
  jobs so no developer-specific global tool can hide a missing dependency.

## Baseline evidence

The source baseline contains 113 Vitest files and 552 tests, plus four Node
screenshot-publishing tests. Test edits in this stage change import specifiers
only. The baseline coverage report measured 80.61% statements, 76.05% branches,
76.77% functions and 82.10% lines against the existing production-file scope.

Windows baseline lint and all three TypeScript checks passed. A clean WSL
Ubuntu 24.04 install/build passed with isolated Node 26.7.0 and pnpm 12.1.0.
The first overlapping Windows/WSL coverage runs hit five-second UI timeouts in
`GlobalSettingsSheet` and `TorrentFileDialog`, followed by a focus failure in
the latter. The Windows run was stopped after 179 seconds. All 17 tests in
those two baseline files passed with `--maxWorkers=1` in 9.36 seconds, without
editing tests or increasing timeouts. Avoid competing media/coverage jobs
when reproducing timings on this host.

## Rollback

Revert this PR's commits together, then run `pnpm install --frozen-lockfile`
with the restored Node/package-manager pins. Restore the package manifest,
lockfile, workspace catalog, config/test imports, Playwright launchers and
Node filename/CI references as one change. Reverting only the manifest leaves
unsupported imports and an incompatible frozen lockfile. The reference tree
is `e0b234c`; do not reset a shared branch to it. No session data or persistent
schema changes are part of this migration.
