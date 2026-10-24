import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  findVerifiedPullRequest,
  imageAuditNeeded,
  verificationPassed,
} from "./ci-verification.mjs";

test("image audits skip unrelated PRs and mandatory version-only manifest changes", () => {
  const before = { version: "1.0.0", dependencies: { express: "5" }, scripts: { build: "tsc" } };
  const after = { ...before, version: "1.0.1" };
  assert.equal(
    imageAuditNeeded(["package.json", "docs/guide.md", "client/src/App.tsx"], before, after),
    false,
  );
});

test("image audits cover dependency, toolchain, patch, container and workflow changes", () => {
  const manifest = { version: "1.0.0" };
  for (const file of [
    "Dockerfile",
    ".dockerignore",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".node-version",
    "patches/library.patch",
    ".github/workflows/docker-build.yml",
    "tooling/ci-verification.mjs",
  ])
    assert.equal(imageAuditNeeded([file], manifest, manifest), true, file);
  for (const after of [
    { ...manifest, dependencies: { express: "5" } },
    { ...manifest, scripts: { postinstall: "node patch.js" } },
    { ...manifest, packageManager: "pnpm@11" },
  ]) {
    assert.equal(imageAuditNeeded(["package.json"], manifest, after), true);
    assert.equal(imageAuditNeeded(["package.json"], after, manifest), true);
  }
});

function scenario() {
  const context = {
    eventName: "push",
    ref: "refs/heads/master",
    sha: "squashed-commit",
    repo: { owner: "owner", repo: "app" },
    payload: { before: "previous-master" },
  };
  const commit = { tree: { sha: "tested-tree" }, parents: [{ sha: "previous-master" }] };
  const pr = {
    number: 70,
    merged_at: "2026-10-24T12:00:00Z",
    merge_commit_sha: "squashed-commit",
    head: { sha: "pr-head", repo: { id: 1 } },
    base: { ref: "master", repo: { full_name: "owner/app" } },
  };
  const run = {
    id: 123,
    event: "pull_request",
    head_sha: "pr-head",
    head_repository: { id: 1 },
    status: "completed",
    conclusion: "success",
  };
  const artifact = { name: "verified-pr-70-tested-tree", expired: false };
  const github = {
    rest: {
      git: { getCommit: async () => ({ data: commit }) },
      repos: { listPullRequestsAssociatedWithCommit: async () => ({ data: [pr] }) },
      actions: {
        listWorkflowRuns: async (request) => {
          assert.equal(request.workflow_id, "quality.yml");
          assert.equal(request.event, "pull_request");
          assert.equal(request.head_sha, "pr-head");
          return { data: { workflow_runs: [run] } };
        },
        listWorkflowRunArtifacts: async () => ({ data: { artifacts: [artifact] } }),
      },
    },
  };
  return {
    github,
    context,
    tree: "tested-tree",
    core: { warning() {} },
    commit,
    pr,
    run,
    artifact,
  };
}

test("a squash merge reuses the successful PR's exact tested tree despite different commit hashes", async () => {
  const input = scenario();
  assert.equal((await findVerifiedPullRequest(input))?.id, 123);
});

test("PR and manual runs always perform full CI", async () => {
  for (const eventName of ["pull_request", "workflow_dispatch"]) {
    const input = scenario();
    input.context.eventName = eventName;
    input.github = {};
    assert.equal(await findVerifiedPullRequest(input), null);
  }
});

test("direct pushes, changed merge results and unverified runs fall back to full CI", async () => {
  const cases = [
    (s) => {
      s.context.ref = "refs/heads/other";
    },
    (s) => {
      s.context.payload.before = "earlier-master";
    },
    (s) => {
      s.commit.parents.push({ sha: "second-parent" });
    },
    (s) => {
      s.commit.tree.sha = "different-checkout";
    },
    (s) => {
      s.pr.merged_at = null;
    },
    (s) => {
      s.pr.merge_commit_sha = "other-commit";
    },
    (s) => {
      s.pr.base.ref = "other-base";
    },
    (s) => {
      s.pr.base.repo.full_name = "other/app";
    },
    (s) => {
      s.pr.head.repo = null;
    },
    (s) => {
      s.run.event = "push";
    },
    (s) => {
      s.run.head_sha = "older-head";
    },
    (s) => {
      s.run.head_repository.id = 2;
    },
    (s) => {
      s.run.status = "in_progress";
    },
    (s) => {
      s.run.conclusion = "failure";
    },
    (s) => {
      s.github.rest.actions.listWorkflowRuns = async () => ({
        data: { workflow_runs: [{ ...s.run, conclusion: "failure" }, s.run] },
      });
    },
    (s) => {
      s.artifact.name = "verified-pr-70-old-tree";
    },
    (s) => {
      s.artifact.name = "verified-pr-71-tested-tree";
    },
    (s) => {
      s.artifact.expired = true;
    },
    (s) => {
      s.github.rest.actions.listWorkflowRunArtifacts = async () => ({ data: { artifacts: [] } });
    },
    (s) => {
      s.github.rest.actions.listWorkflowRuns = async () => ({ data: { workflow_runs: [] } });
    },
    (s) => {
      s.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => ({ data: [] });
    },
    (s) => {
      s.github.rest.actions.listWorkflowRunArtifacts = async () => {
        throw new Error("API unavailable");
      };
    },
  ];
  for (const mutate of cases) {
    const input = scenario();
    mutate(input);
    assert.equal(await findVerifiedPullRequest(input), null, mutate.toString());
  }
});

function jobs(reuse = false) {
  return {
    prepare: { result: "success", outputs: { reuse: String(reuse) } },
    checks: { result: reuse ? "skipped" : "success" },
    compatibility: { result: reuse ? "skipped" : "success" },
    dependencies: { result: reuse ? "skipped" : "success" },
    e2e: { result: reuse ? "skipped" : "success" },
    container: { result: "success" },
  };
}

test("Verification accepts a fully successful run or proven reuse with a verified release image", () => {
  assert.equal(verificationPassed(jobs()), true);
  assert.equal(verificationPassed(jobs(true)), true);
});

test("Verification rejects failures, cancellation, missing jobs and skips without reuse evidence", () => {
  for (const reuse of [false, true]) {
    for (const name of Object.keys(jobs())) {
      for (const result of ["failure", "cancelled", "missing", "skipped"]) {
        if (reuse && result === "skipped" && !["prepare", "container"].includes(name)) continue;
        const input = jobs(reuse);
        input[name].result = result;
        assert.equal(verificationPassed(input), false, `${reuse} ${name} ${result}`);
      }
      const input = jobs(reuse);
      Reflect.deleteProperty(input, name);
      assert.equal(verificationPassed(input), false, `missing ${name}`);
    }
  }
});
