# Testing and quality

## Local checks

`vpr quality` runs formatting, typed lint, all TypeScript projects, coverage,
Fallow dead-code and duplication checks, the health floor, and the production
build. Lint warnings fail the check.

Use `vpr test` for the full Vitest suite or `vpr test:watch` while editing.
Focused scripts are `test:unit`, `test:component`, `test:integration` and `test:ui`.
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
The suite covers workspace flows, keyboard and touch input, responsive layouts
and Axe accessibility checks. Use a real browser for changed user flows and
inspect screenshots as well as overflow assertions.

The [screenshot skill](../../.agents/skills/pr-screenshots/SKILL.md) owns PR gallery
capture, inspection and publishing. Its HTTP and torrent progress is simulated;
real transfer integration tests run separately.

## Coverage and code health

Coverage includes production TypeScript under `client/src`, `server` and `shared`,
including untested modules. `vpr test:coverage` writes reports to `coverage/`.
Thresholds live in `vite.config.ts`, including stricter rules for core modules.
Do not exclude production code or lower thresholds to raise the result.

`vpr fallow:health` enforces the score in `package.json`. Use `vpr fallow:targets`
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

PRs run clean Windows/Linux install and build checks, the non-browser quality
gate, each test suite, Chromium/Firefox/WebKit E2E, media benchmarks, the roadmap
check, and the device/theme gallery. Docker checks load the production image,
verify health and retained-data restart, decode HLS, and play and seek in Chromium.
See `.github/workflows/` for exact steps and retained artifacts.
