# Dependency and release maintenance

Dependabot proposes weekly compatible runtime, development, Actions and Docker
updates. Major updates remain separate for compatibility review. When enabled
in repository settings, security updates use separate runtime/development groups
and do not wait for the weekly version-update schedule. The npm updater uses the repository's pnpm manifest,
lockfile and workspace catalogs. Keep Vite+ and its Docker base aligned, and keep
Vitest and coverage versions compatible with Vite+.

## Review an update

Review the manifest and lockfile together, including transitive changes,
registry sources, integrity hashes, lifecycle scripts, overrides and local
patches. Use the `lockfile-review.diff` artifact from Dependency maintenance for
the exact base-to-head comparison. Reproduce with `vp install --frozen-lockfile`.
Do not hand-edit resolutions or discard a patch without checking why it exists.
Update `tooling/dependency-purposes.json` when adding or removing a direct
dependency; the report rejects missing or stale purposes.

Run `vpr dependencies:report` after installing. It writes an exact installed
version/license inventory, direct dependency purposes, the production pnpm audit
and a triage summary under `test-results/dependency-maintenance/`. This includes
development licenses because build and test tools also need review. Unknown
license metadata needs investigation; an inventory is not a license approval.
Machine paths are omitted from the inventory. Do not commit generated reports.

Dependency PRs use the same version bump, quality, coverage, browser, gallery and
production-container gates as application PRs. The existing HTTP, archive and
contract suites run on every update. The release regression fixture follows an
HTTP URL with a signed query, confirms the download through RPC and checks
exact ZIP content plus Unicode entry paths across the shared contract.
Add a focused real fixture when an update changes behavior; crawler fixtures belong with the proposed discovery feature,
which is not implemented yet. Never replace a failing real flow with mocks or
lower timing, coverage or browser gates. Benchmark measurements remain evidence
for review; existing correctness and resource-budget assertions still apply.

## Triage vulnerabilities

Dependency maintenance runs on PRs, master pushes and weekly against the locked
production dependency graph. Docker Build also runs weekly and on demand, builds
the current production image, and retains an SPDX package/license SBOM plus a
Grype JSON vulnerability report. Reports include unfixed findings. Tool crashes,
invalid audit output, registry failures and missing artifacts fail the job;
reported advisories are review evidence, not an automatic severity-only gate.
A green reporting job does not mean the app is free of vulnerabilities.

For each finding, record the advisory, package and installed/fixed versions,
dependency path, reachable input and affected app behavior in the PR or tracking
issue. Separate build-only exposure from deployed runtime and OS packages. For
a deferred finding, include the reason, owner and next review date. Recheck it
when a fixed upstream release appears. Do not add blanket ignores or mark a
finding unreachable based only on its severity or package name. Use the runtime
audit's dependency paths and the image SBOM to distinguish scanner differences.
Use the upstream advisory and release notes to select a fix, then run the real
affected flow and all existing gates before merging.

## Image provenance and licenses

Master pushes attach maximum BuildKit provenance and an SBOM to the published
image digest. Inspect these with `docker buildx imagetools inspect IMAGE@DIGEST`
and its `--format '{{json .Provenance}}'` or `--format '{{json .SBOM}}'` options.
The digest in the build output identifies the image to verify; a mutable tag
alone does not. See [Docker's attestation guide](https://docs.docker.com/build/ci/github-actions/attestations/).
PR builds load the image for real playback/retention checks. Docker's local
exporter cannot preserve attestations, so PR artifacts include a separately
generated image SBOM and vulnerability scan. Scheduled/on-demand builds scan
without publishing images or using registry credentials.

Package license fields do not fully describe bundled executables. Review the
FFmpeg build configuration and applicable GPL/LGPL terms, 7-Zip notices, native
image libraries and Debian package licenses before redistributing an image.
The npm inventory and image SBOM are complementary evidence; retain required
notices and source offers according to the components actually shipped.

PR screenshots use immutable commit names in release assets, without asset
branches. Keep existing release assets and historical commit refs, including
refs used by older PR galleries. Follow the
[screenshot skill](../../.agents/skills/pr-screenshots/SKILL.md) for capture and
publishing; asset capacity rollover must preserve old URLs.
