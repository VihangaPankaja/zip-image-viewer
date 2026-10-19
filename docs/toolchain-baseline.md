# Vite+ toolchain baseline

Roadmap tasks B01, B02 and B03, implemented together in v3.20.0.
The reference and rollback point is `e0b234c`.

## Versions and ownership

Stable Vite+ **1.3.0** supplies the core alias (Vite 8.3.4), Vitest/coverage
**5.0.5**, Rolldown 1.2.14, Oxlint 1.88.0, oxlint-tsgolint 7.0.2004 and
Oxfmt 0.73.0. Exact catalog pins and overrides live in `pnpm-workspace.yaml`.
No runtime dependency upgrades or canary releases were needed.

`.node-version` pins Node **26.7.0**; `package.json#packageManager` pins pnpm
**12.1.0**. The global Vite+ CLI manages both. Without a global CLI, use these
versions, `pnpm install --frozen-lockfile` and `pnpm exec vp run <script>`.

`vite.config.ts` owns client builds, both test projects, production coverage,
Oxlint, Oxfmt and staged checks. The three TS projects retain client/server/test
compilation boundaries. Playwright and Fallow configure their independent checks.
Use `vp check`, `vp test` and `vpr build`. The latter builds client **and**
server; `vp build` alone builds the client. Server `tsc` emission and the
complete `build/server` and `build/shared` output remain. The direct `vite`
alias serves the benchmark's programmatic API. Test imports/types use Vite+.

Oxfmt uses native defaults, including package sorting. Native hooks replace
Lefthook: prepare installs the dispatcher, pre-commit runs `vp staged`, and
pre-push runs all TS checks, changed tests against `origin/master`, and Fallow's
branch audit. Docker disables hook installation with `VP_GIT_HOOKS=0`.

The cache directory is anchored to the config file: dev uses `client/` while
tests use the repository root. A relative cache path escaped the test checkout
and shared results between worktrees; the absolute path keeps each cache local.

CI uses official setup-vp with frozen installs, including clean Windows/Linux
install/typecheck/build jobs. Docker builds with the pinned official Vite+ image,
installs production dependencies separately, and copies the Node selected by
`.node-version` into the non-root runtime. No dev toolchain is needed at runtime.

## Migration review

The target migrator ran from the root with original manifests/dependencies
available, using `pnpm dlx --package=vite-plus@1.3.0 vp migrate
--no-interactive --no-agent --no-editor --no-hooks`. After a staged baseline,
the full config/lint/format/hooks migration was completed. Vite 8 and Vitest 5
already met prerequisites; no v4 test or tsdown compatibility settings were
needed. Native runner validation allowed removing runner-loader/webstorage flags.

Two rejection assertions register before triggering their rejection and await
a saved promise afterward. Narrow explained `vitest/valid-expect` exceptions
preserve these in useImagePreviewCache.test.tsx and torrentDownloader.test.ts.
The old related-test hook forwarded an extra `--` and silently selected no
changed files. The native hook uses `--changed origin/master`.

References reviewed: [migration](https://viteplus.dev/guide/migrate),
[migration rules](https://viteplus.dev/guide/migrate-rules),
[Vitest 5](https://viteplus.dev/guide/vitest-v5),
[lint](https://viteplus.dev/guide/lint), [Docker](https://viteplus.dev/guide/docker).

## Lint parity

Original effective JS, TS, TSX and test configs were compared with native rules.
Warnings remain fatal and unused disable directives are errors. Strict rules
are explicit in vite.config.ts.

| Original policy                            | Decision                | Owner and reason                                                                                                                                                                                                                                                |
| ------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recommended core correctness               | Kept                    | Same native core rules; TS overrides preserve compiler-owned exclusions.                                                                                                                                                                                        |
| strictTypeChecked                          | Replaced                | Native typescript/* checks preserve await-thenable, floating/misused promises, unsafe argument/assignment/call/member/return, unnecessary conditions/assertions, restricted operands/templates, return-await and unbound methods, with original scoped options. |
| Explicit any / unused variables            | Replaced                | typescript/no-explicit-any and native no-unused-vars retain the underscore argument convention.                                                                                                                                                                 |
| Union exhaustiveness                       | Added                   | switch-exhaustiveness-check rejects missing cases even with a default.                                                                                                                                                                                          |
| Hooks recommended                          | Replaced                | Native react/* checks preserve order, dependencies, purity, immutability, refs, memoization, static components and render-state checks. Warnings are fatal.                                                                                                     |
| react-hooks/config and gating              | Removed as inapplicable | Validate React Compiler options/gating; this app enables neither. Reassess if compiler configuration is added. No ESLint bridge is needed.                                                                                                                      |
| no-dupe-args / no-octal                    | Parser/compiler         | Strict ESM parsing rejects duplicate parameters and legacy octal literals. Original TS config already delegated duplicate arguments to the compiler.                                                                                                            |
| File/function size 350/80                  | Kept                    | Native rules retain production scopes, blank/comment exclusions and narrow inline exceptions. Test callbacks remain excluded.                                                                                                                                   |
| set-state-in-effect disabled               | Kept                    | Controllers synchronize external media/session state in effects, e.g. useVideoSource and useSessionHydration. Changing that needs a behavioral refactor; hook/dependency/render-state checks stay enabled.                                                      |
| SessionRail incompatible-library exception | Kept                    | TanStack Virtual exposes intentionally non-memoizable functions; exception remains file-scoped.                                                                                                                                                                 |
| No test-specific gate                      | Added                   | Native Vitest rejects focused tests, malformed/unawaited assertions, duplicate titles and invalid suite callbacks. Supertest/Node assert are recognized.                                                                                                        |
| No JSX accessibility gate                  | Added                   | Native alt text, anchor content, ARIA name/type and role checks supplement existing Axe/browser tests.                                                                                                                                                          |
| Prettier                                   | Replaced                | Oxfmt is the sole formatter; native defaults reflow existing code without altering assertions or coverage scope.                                                                                                                                                |

New opinionated mock-generic, conditional-assertion and required-error-message
rules are off: contextual mocks, parameterized tests and type/status assertions
are valid. User-media previews load captions separately; focusable preview
regions, keyboard-equivalent drag controls and the roving torrent checkbox list
have narrow explained JSX exceptions. There is no global accessibility disable.

The real-CLI regression in tests/integration/toolchainLint.test.ts requires
eight diagnostics from a temporary invalid fixture: floating/misused promises,
unsafe assignment, missing union case, hook order/dependencies, focused tests
and an unawaited assertion. It catches broken scopes/type-aware rule loading.

## Measurements and verification

Baseline: 113 Vitest files / 552 tests plus four Node publishing tests.
Whole-production coverage: 80.61% statements, 76.05% branches, 76.77% functions,
82.10% lines. Windows baseline lint/all TS checks and clean Ubuntu 24.04
install/build passed with isolated Node 26.7.0/pnpm 12.1.0.

Paired quiet WSL builds used separate frozen installs. Cold removed dist, build
and .vite-cache; OS, pnpm store and Node compile caches remained. Warm was the
immediately following build.

| Complete client/server build | Baseline e0b234c | Initial Vite+ stage |
| ---------------------------- | ---------------: | ------------------: |
| Cold                         |           2.68 s |              2.27 s |
| Warm                         |           2.66 s |              2.47 s |

These single samples are observations, not guarantees. Competing media/coverage
jobs caused baseline five-second UI timeouts; all 17 affected tests passed in
isolation without timeout/assertion changes. The staged baseline passed all 552
tests on Windows/Linux plus four publishing tests. Windows coverage passed the
unchanged floors at 80.59/76.08/76.90/82.08% (statements/branches/functions/lines).

The final unified suite includes publishing and one new lint regression:
115 files / 557 tests. Final verification evidence is recorded in the PR.

## Rollback

Before reverting, run `vp hooks disable` (or `pnpm exec vp hooks disable`)
while Vite+ is installed. This removes the clone-local dispatcher and clears
`core.hooksPath`; the restored install can then reinstate the previous hooks.

Revert this PR's commits together and install the restored frozen lockfile with
the restored Node/package-manager pins. Manifest, lockfile, catalog, config/test
imports, hooks, Docker and CI must move together; reverting only the manifest
leaves incompatible imports/resolution. Compare with e0b234c, without resetting
a shared branch. No persistent schema or session-data changes are involved.
