# Testing and quality

## Local checks

`vpr quality` runs formatting, typed lint and type checks through `vp check`, coverage,
Fallow dead-code and duplication checks, an advisory health score, and the production
build. Lint warnings fail the check.

Use `vpr test` for the full Vitest suite or `vpr test:watch` while editing.
Focused scripts are `test:unit`, `test:component`, `test:integration` and `test:ui`.
Tests mirror production paths under `tests/unit/{client,server}/`,
`tests/component/client/`, `tests/integration/{client,server}/` and `tests/ui/client/`.
Classify by behavior: pure functions belong in unit, rendered React hooks and
components in component, and real filesystem, HTTP, archive or process work in
integration. App composition belongs in UI. Shared fixtures stay in
`tests/fixtures/`; DOM setup lives in `tests/component/client/setup.ts`.
The client test project uses jsdom and the server/tooling project uses Node.
Vitest uses two workers to bound concurrent browser environments and media fixtures.
Production TypeScript projects exclude tests and their fixtures.
Pass a file to the runner for a single test, for example:

```sh
vp test tests/integration/toolchainLint.test.ts
```

## Browser checks

Install browsers once, then run the E2E suite:

```sh
vp exec playwright install --with-deps
vpr test:e2e
```

For one browser, run `vp exec playwright test --project=chromium`.
E2E uses two workers locally and in CI; override with `--workers=1` when debugging.
E2E artifacts stay in `test-results/e2e-run/` so the runner's cleanup preserves
other verification evidence.
The suite covers workspace flows, keyboard and touch input, responsive layouts
and Axe accessibility checks. Use a real browser for changed user flows and
inspect screenshots as well as overflow assertions.

For changes with a visible effect, the
[screenshot skill](../../.agents/skills/pr-screenshots/SKILL.md) covers targeted
local captures and direct PR attachments. Use dark mode by default and capture
all affected themes, surfaces and accents for color/theme changes. Screenshots
are not a CI job or release asset. Shared browser fixtures remain in
`tests/review/fixtures.ts`; their HTTP and torrent progress is simulated, while
real transfer integration tests run separately.

## Coverage and code health

Coverage includes production TypeScript under `client/src`, `server` and `shared`,
including untested modules. `vpr test:coverage` writes reports to `coverage/`.
Thresholds live in `vite.config.ts`, including stricter rules for core modules.
Do not exclude production code or lower thresholds to raise the result.

`vpr fallow:health` reports an advisory aggregate score. Use `vpr fallow:targets`
for refactor candidates and `vpr fallow:audit` for changes against `origin/master`.
Existing advisory debt may appear in the audit; new issues still fail its gate.
Keep lint exceptions narrow and explain them next to the code.

## Media benchmarks

Run benchmarks without competing tests or encoders. Read generated reports for
the actual environment and results; timings from different machines are not
directly comparable.

| Script                     | Measures                                                                                               | Default report                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `vpr benchmark:video`      | Startup, seeking, buffer, transfer and encoder timing for original, prepared and cold HLS.             | `test-results/video-latency.md`                                              |
| `vpr benchmark:encoding`   | CPU and available hardware modes, encode time, output size, decoded seeks and SSIM quality comparison. | Standard output. Use `--output test-results/video-encoding.json` to save it. |
| `vpr benchmark:storyboard` | Preview-sheet and pointer-drag latency under media load, without seeking during dragging.              | `test-results/storyboard-performance.json`                                   |
| `vpr benchmark:seek`       | Displayed-frame latency on a real hour-long video with two audio languages.                            | `test-results/priority-seek-metrics.json`                                    |

The seek benchmark checks a cold jump near the end and repeated prepared seeks
on loopback and controlled 10 Mbps profiles. Hardware reports identify the
actual encoder; CPU fallback does not prove GPU performance. Keep generated
reports in test artifacts or PR evidence, not maintained guides.

## CI

PRs and unverified master pushes show Linux, Windows and macOS compatibility checks,
dependency review and three separate browser checks. Each compatibility check
verifies dependency installation and the production build. A separate Linux job
runs the full quality gate, validates workflow syntax with Actionlint and runs
every Vitest suite once with coverage. Formatting, lint and full type checks
run once on Linux.
PRs also gate new Fallow findings against their base commit. Dead-code,
dependency, architecture and duplication checks remain blocking; the aggregate
health score is advisory. The roadmap TODO document has no dedicated checker.
The `version-bump` check validates a stable numeric `major.minor.patch` app
version and rejects decreases. An unchanged version passes, including on
Dependabot PRs. Its check name is retained for existing required-check settings.

Successful PR runs retain a small verification record for 14 days. After a
squash merge, a read-only planning job checks that the push contains exactly
that merged PR and that its tracked files match the tested merge tree. When
the latest Quality run for that PR head succeeded and its record matches, CI
reuses its static, OS, dependency and browser results. Direct pushes, changed
trees, missing or expired records and API failures run full CI. Manual runs
also perform full verification.

After these checks pass, the container job builds a local image with provenance,
verifies health and retained-data restart, decodes HLS with hardware selection
or CPU fallback, and plays and seeks in Chromium. PRs that change dependencies,
container inputs, patches or CI/tooling also generate a BuildKit SBOM and scan
it. Version-only package changes do not trigger that audit. Master, manual and
scheduled maintenance runs always audit. The scanner reads the exact local
build's SBOM; no second inventory scan is generated.
Medium or higher image vulnerabilities with an available fix fail container
verification and block publication. Full reports retain unfixed findings too;
both full and fixable-only reports remain available after failure. The production
container also verifies native archive extraction, encryption detection, literal
filenames, RAR, concatenated gzip and link rejection.
Master pushes then publish that same image without rebuilding. PR, scheduled
and manual maintenance runs do not publish images. The final `Verification`
check requires successful verification or a proven reused PR run, plus
successful container verification. The release image is built and verified
on master even when the source checks are reused.
Master Quality and container runs queue without cancelling earlier pushes;
PR runs still cancel superseded runs. GitHub allows up to 100 pending runs per
concurrency group. Each verified master image receives a unique build version;
see [deployment](../reference/deployment.md#image-versions-and-rollback).
Chromium and Firefox E2E run on Linux; WebKit runs on macOS to exercise Safari's
platform media support. WebKit uses Playwright's browser build rather than released Safari.
The WebKit browser job enables keyboard navigation through all controls so Tab
and focus checks exercise buttons and radios as well as text fields and selects.
Full media benchmarks run daily, manually and on PRs that affect the media code,
fixtures or toolchain lockfile. Version-only and documentation changes do not
trigger them. Workloads stay sequential so competing encoders do not distort
measurements. Host encoder/CPU fallback measurements run here alongside latency,
storyboard and seek measurements, and their reports are retained together.
Weekly/manual dependency maintenance also verifies and scans the current image.
Coverage, dependency and container reports and browser failure evidence are
retained as Actions artifacts. Screenshots for PR review are direct attachments.
See `.github/workflows/` for exact steps and retained artifacts.
