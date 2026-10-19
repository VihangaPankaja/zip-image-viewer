export async function publishScreenshotRelease({
  run,
  repository,
  sourceCommit,
  files,
  tag = "pr-review-assets",
  request = globalThis.fetch,
}) {
  if (!/^pr-review-assets(?:-\d+)?$/.test(tag))
    throw new Error(
      "PR_SCREENSHOT_RELEASE must be pr-review-assets or pr-review-assets-N.",
    );
  const releases = JSON.parse(
    run(["api", `repos/${repository}/releases`, "--paginate", "--slurp"]),
  ).flat();
  let release = releases.find((entry) => entry.tag_name === tag);
  if (!release) {
    run([
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--target",
      sourceCommit,
      "--title",
      "PR review assets",
      "--notes",
      "Durable screenshot assets embedded in pull request descriptions. Transfer progress in fixture galleries is simulated.",
      "--prerelease",
      "--latest=false",
    ]);
    release = JSON.parse(
      run(["api", `repos/${repository}/releases/tags/${tag}`]),
    );
  }
  const existing = new Set(
    JSON.parse(
      run([
        "api",
        `repos/${repository}/releases/${release.id}/assets`,
        "--paginate",
        "--slurp",
      ]),
    )
      .flat()
      .map((asset) => asset.name),
  );
  if (
    existing.size + files.filter(({ name }) => !existing.has(name)).length >
    1000
  )
    throw new Error(
      "Review release is full. Set PR_SCREENSHOT_RELEASE to the next pr-review-assets-N tag; keep existing assets for old PRs.",
    );
  for (const { name, path } of files) {
    if (!existing.has(name))
      run(["release", "upload", tag, path, "--repo", repository]);
    const response = await request(
      `https://github.com/${repository}/releases/download/${tag}/${name}`,
      { method: "HEAD", signal: globalThis.AbortSignal.timeout(30000) },
    );
    if (!response.ok)
      throw new Error(
        `Published review asset is not accessible: ${name} (${response.status}).`,
      );
  }
}
