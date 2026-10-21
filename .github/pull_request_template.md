## Change

Describe the problem, resulting behavior and roadmap task completed.

## Validation

Record quality, test, browser and production-container results. Attach the device/theme gallery using the PR screenshot skill.

## Dependency and release review

For dependency changes, review `dependency-maintenance` artifacts and the manifest/lockfile diff together. Explain unexpected transitive changes, patches, registry sources, install scripts, licenses and direct dependency purposes. Review runtime advisories and the Docker image SBOM/scan, including installed/fixed versions and reachability. Record the decision, owner and next review date for deferred findings. Follow [the maintenance guide](../docs/development/dependencies.md).

Bump the app version for PRs to master. Dependency PRs run the same coverage, browser and production-image checks as application PRs.
