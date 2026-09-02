import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Docker runtime image", () => {
  it("copies the complete server build into the runtime stage", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");

    expect(dockerfile).toContain("COPY --from=build /app/build ./build");
  });

  it("requires detached containers to retain plain startup logs", async () => {
    const workflow = await readFile(
      ".github/workflows/docker-build.yml",
      "utf8",
    );

    expect(workflow).toContain("[INFO] server.started");
  });
});
