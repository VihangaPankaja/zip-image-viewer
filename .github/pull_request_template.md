## Change

Describe the problem, resulting behavior and roadmap task completed.

## Validation

Record quality, test, browser and production-container results. For visible changes,
attach screenshots of the affected areas using the [PR screenshot skill](../.agents/skills/pr-screenshots/SKILL.md).
Use dark mode by default; include all affected themes, surfaces and accents for
color/theme changes. Backend changes can affect the UI. If there is no visible
effect, state that screenshots are not needed and why.

## Dependency and release review

For dependency changes, review `dependency-maintenance` artifacts and the manifest/lockfile diff together. Explain unexpected transitive changes, patches, registry sources, install scripts, licenses and direct dependency purposes. Review runtime advisories and the Docker image SBOM/scan, including installed/fixed versions and reachability. Record the decision, owner and next review date for deferred findings. Follow [the maintenance guide](../docs/development/dependencies.md).

App version bumps are optional. Keep a valid, non-decreasing `major.minor.patch` version; CI generates a unique Docker build version after merge. Dependency PRs run the same coverage, browser and production-image checks as application PRs.
