import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";

describe("Docker runtime image", () => {
  it("copies the complete server build into the runtime stage", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");

    expect(dockerfile).toContain("COPY --from=build /app/build ./build");
  });

  it("requires detached containers to retain plain startup logs", async () => {
    const workflow = await readFile(".github/workflows/docker-build.yml", "utf8");

    expect(workflow).toContain("[INFO] server.started");
  });

  it("fails container verification on medium or higher vulnerabilities and retains evidence", async () => {
    const workflow = (await readFile(".github/workflows/docker-build.yml", "utf8")).replaceAll(
      "\r\n",
      "\n",
    );
    const scan = workflow.slice(workflow.indexOf("        uses: anchore/scan-action@"));
    const scanStep = scan.split("\n      - name:")[0];

    expect(scanStep).toContain("fail-build: true");
    expect(scanStep).toContain("severity-cutoff: medium");
    expect(scanStep).not.toContain("only-fixed: true");
    expect(workflow).toContain(
      "- name: Retain image inventory and vulnerability evidence\n        if: always()",
    );
    expect(workflow.indexOf("uses: anchore/scan-action@")).toBeLessThan(
      workflow.indexOf("- name: Publish the verified candidate without rebuilding"),
    );
  });
});
