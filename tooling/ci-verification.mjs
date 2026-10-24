export function imageAuditNeeded(files, before, after) {
  const auditFiles = new Set([
    "Dockerfile",
    ".dockerignore",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".node-version",
  ]);
  // Every PR bumps the app version; that alone does not change installed packages.
  return (
    files.some(
      (file) =>
        auditFiles.has(file) ||
        ["patches/", ".github/workflows/", "tooling/"].some((prefix) => file.startsWith(prefix)),
    ) ||
    JSON.stringify({ ...before, version: undefined }) !==
      JSON.stringify({ ...after, version: undefined })
  );
}

export async function findVerifiedPullRequest({ github, context, core, tree }) {
  if (context.eventName !== "push" || context.ref !== "refs/heads/master") return null;
  try {
    const repo = context.repo;
    const { data: commit } = await github.rest.git.getCommit({ ...repo, commit_sha: context.sha });
    if (
      commit.parents.length !== 1 ||
      commit.parents[0].sha !== context.payload.before ||
      commit.tree.sha !== tree
    )
      return null;

    const { data: prs } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
      ...repo,
      commit_sha: context.sha,
      per_page: 100,
    });
    const pr = prs.find(
      (candidate) =>
        candidate.merged_at &&
        candidate.merge_commit_sha === context.sha &&
        candidate.base.ref === "master" &&
        candidate.base.repo.full_name.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase(),
    );
    if (!pr?.head.repo) return null;

    const {
      data: { workflow_runs: runs },
    } = await github.rest.actions.listWorkflowRuns({
      ...repo,
      workflow_id: "quality.yml",
      event: "pull_request",
      head_sha: pr.head.sha,
      per_page: 100,
    });
    const run = runs.find(
      (candidate) =>
        candidate.event === "pull_request" &&
        candidate.head_sha === pr.head.sha &&
        candidate.head_repository?.id === pr.head.repo?.id,
    );
    if (!run || run.status !== "completed" || run.conclusion !== "success") return null;

    const {
      data: { artifacts },
    } = await github.rest.actions.listWorkflowRunArtifacts({
      ...repo,
      run_id: run.id,
      per_page: 100,
    });
    // Only the successful aggregate job records the PR number and tested merge tree.
    return artifacts.some(
      (artifact) =>
        artifact.expired === false && artifact.name === `verified-pr-${pr.number}-${tree}`,
    )
      ? run
      : null;
  } catch (error) {
    core.warning(`Cannot reuse PR verification; running full CI: ${error.message}`);
    return null;
  }
}

export function verificationPassed(jobs) {
  const checks = ["checks", "compatibility", "dependencies", "e2e"];
  const reused = jobs.prepare?.outputs?.reuse === "true";
  return (
    ["prepare", "container"].every((name) => jobs[name]?.result === "success") &&
    (checks.every((name) => jobs[name]?.result === "success") ||
      (reused && checks.every((name) => jobs[name]?.result === "skipped")))
  );
}
