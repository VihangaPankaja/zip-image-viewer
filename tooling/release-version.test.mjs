import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "vite-plus/test";
import { imageVersion, validateAppVersion } from "./release-version.mjs";

test("PR app versions may stay unchanged or increase numerically", () => {
  for (const version of ["3.31.1", "3.31.2", "3.32.0", "4.0.0"]) {
    assert.equal(validateAppVersion(version, "3.31.1"), version);
  }
  assert.equal(validateAppVersion("3.10.0", "3.9.0"), "3.10.0");
  assert.equal(
    validateAppVersion("9007199254740993.0.0", "9007199254740992.0.0"),
    "9007199254740993.0.0",
  );
  assert.equal(validateAppVersion("0.0.0"), "0.0.0");
  assert.throws(() => validateAppVersion("3.30.99", "3.31.1"), /decrease/);
  assert.throws(() => validateAppVersion("3.9.0", "3.10.0"), /decrease/);
});

test("the PR version workflow accepts an unchanged Dependabot manifest and rejects a decrease", async () => {
  const workflow = await readFile(".github/workflows/version-check.yml", "utf8");
  const script = workflow.match(/node --input-type=module <<'EOF'\r?\n([\s\S]*?)\r?\n\s+EOF/)?.[1];
  assert.ok(script, "The version check must execute the shared validator");
  const directory = await mkdtemp(path.join(tmpdir(), "ziv-version-check-"));
  try {
    await mkdir(path.join(directory, "tooling"));
    await copyFile(
      "tooling/release-version.mjs",
      path.join(directory, "tooling/release-version.mjs"),
    );
    const manifest = path.join(directory, "package.json");
    await writeFile(manifest, JSON.stringify({ version: "3.31.1" }));
    const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
    git("init", "--quiet");
    git("add", "package.json");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
    git("update-ref", "refs/remotes/origin/master", "HEAD");
    const run = () =>
      execFileSync(process.execPath, ["--input-type=module"], {
        cwd: directory,
        input: script,
        encoding: "utf8",
        env: { ...process.env, BASE_REF: "master" },
        stdio: "pipe",
      });
    assert.match(run(), /3\.31\.1 -> 3\.31\.1/);
    await writeFile(manifest, JSON.stringify({ version: "3.32.0" }));
    assert.match(run(), /3\.31\.1 -> 3\.32\.0/);
    await writeFile(manifest, JSON.stringify({ version: "3.30.9" }));
    assert.throws(run, /must not decrease/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("app versions require exactly three numeric components without leading zeros", () => {
  for (const version of [
    undefined,
    null,
    1,
    "",
    "3.1",
    "3.1.2.3",
    "03.1.2",
    "3.-1.2",
    "3.1.x",
    "3.1.2-beta",
    "3.1.2+meta",
    "3.1.2\n",
  ]) {
    assert.throws(() => validateAppVersion(version), /Invalid app version/);
    if (version !== undefined)
      assert.throws(() => validateAppVersion("3.1.2", version), /Invalid app version/);
  }
});

test("Docker build versions distinguish pushes and reruns and preserve manual app versions", () => {
  assert.equal(imageVersion("3.31.1", "250", "1"), "3.31.1-build.250.1");
  assert.equal(imageVersion("3.31.1", "251", "1"), "3.31.1-build.251.1");
  assert.equal(imageVersion("3.31.1", "251", "2"), "3.31.1-build.251.2");
  assert.equal(imageVersion("3.32.0", "252", "1"), "3.32.0-build.252.1");
  for (const value of [undefined, "", "0", "01", "-1", "1.5", "1\n"]) {
    assert.throws(() => imageVersion("3.31.1", value, "1"), /Invalid build counter/);
    assert.throws(() => imageVersion("3.31.1", "251", value), /Invalid build counter/);
  }
  assert.throws(() => imageVersion("3.31.1", "1".repeat(120), "1"), /128/);
});

test("Docker workflow writes the generated version into its disposable build context and outputs", async () => {
  const workflow = await readFile(".github/workflows/docker-build.yml", "utf8");
  const step = workflow.split("- name: Prepare image version")[1]?.split("\n      - name:")[0];
  const script = step?.match(/node --input-type=module <<'EOF'\r?\n([\s\S]*?)\r?\n\s+EOF/)?.[1];
  assert.ok(script, "Version preparation must execute the tested Node helper");
  const directory = await mkdtemp(path.join(tmpdir(), "ziv-release-version-"));
  try {
    await mkdir(path.join(directory, "tooling"));
    await copyFile(
      "tooling/release-version.mjs",
      path.join(directory, "tooling/release-version.mjs"),
    );
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "fixture", version: "3.31.1", private: true }),
    );
    const output = path.join(directory, "outputs.txt");
    execFileSync(process.execPath, ["--input-type=module"], {
      cwd: directory,
      input: script,
      env: {
        ...process.env,
        GITHUB_RUN_NUMBER: "251",
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_OUTPUT: output,
      },
    });
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")), {
      name: "fixture",
      version: "3.31.1-build.251.2",
      private: true,
    });
    assert.equal(await readFile(output, "utf8"), "version=3.31.1-build.251.2\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
