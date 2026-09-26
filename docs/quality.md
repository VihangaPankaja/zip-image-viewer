# Quality checks

Run `pnpm run quality` before a PR. CI enforces formatting, zero lint warnings, client/server/test type checks, full production coverage, dead code and dependency checks, duplicate detection, the Fallow health floor, and a production build. CI also runs the branch audit, all test suites, Chromium/Firefox/WebKit flows, the video benchmark, and the device/theme screenshot gallery. Failed browser runs retain their reports; coverage and gallery artifacts are retained for 14 days.

## Coverage scope and floors

Coverage includes every production TypeScript module under `client/src`, `server`, and `shared`, including modules with no tests. Only test files, declarations, and client test setup are excluded. The previous report included 11 selected files: its 96.68% statement coverage did not measure the rest of the app.

With the expanded scope, the starting baseline was 60.21% statements, 56.05% branches, 60.16% functions, and 61.49% lines. The new regression tests raise that baseline to approximately 68% statements, 64% branches, 66% functions, and 69% lines. The corresponding whole-repository floors are 68/64/66/69. Existing critical-module floors remain: 95% statements/functions/lines and 90% branches for shared contracts and the original core backend modules; 85/80 for the original client utilities.

Raise floors as coverage improves. Do not shrink the include list or exclude untested production modules to raise percentages. Favor failures users can encounter: cancellation, retry exhaustion, partial HTTP ranges, expired sessions, stale cache requests, blocked storage, keyboard operation, and actual browser flows.

## Fallow

`pnpm run fallow:health` uses the same whole-project score scope as before, with the CI floor raised from 80 to 88. The current measured score is 88.7, below the requested 95 target. Remaining deductions are function size (10 points) and coupling (1.3 points); the size penalty is saturated, so small refactors do not move the displayed score. Large test-suite callbacks also contribute. No ignores or scoring weights were added to conceal this debt.

Use `pnpm run fallow:targets` and `pnpm run fallow:audit` to guide further work. Split long functions only at useful behavioral boundaries, add regression coverage before changing complex flows, and raise the floor once the full-scope score supports it. `health --score` is the stable CI metric; the full interactive report additionally includes history-dependent churn hotspots and can show a different score.

## Visual review

Follow the [PR screenshots skill](../.agents/skills/pr-screenshots/SKILL.md). Capture and publish commands are in `package.json`. The review gallery is deterministic in content, time, viewport, and network fixtures; fonts and native media controls can differ between operating systems. HTTP and torrent progress in the gallery is simulated and labeled. Real HTTP/magnet integration tests run separately.

Keep the [design system](design-system.md) current when changing color, spacing, control sizing, or responsive behavior.
