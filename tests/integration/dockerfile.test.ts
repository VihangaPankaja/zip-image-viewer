import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";

describe("Docker runtime image", () => {
  it("declares 7-Zip with the canonical vulnerability identifier", async () => {
    const inventory = await readFile("tooling/7zip.cdx.json", "utf8");

    expect(inventory).toMatch(/"cpe": "cpe:2\.3:a:7-zip:7-zip:\d+\.\d+:\*:\*:\*:\*:\*:\*:\*"/);
  });

  it("copies the complete server build into the runtime stage", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");

    expect(dockerfile).toContain("COPY --from=build /app/build ./build");
  });

  it("requires detached containers to retain plain startup logs", async () => {
    const workflow = await readFile(".github/workflows/docker-build.yml", "utf8");

    expect(workflow).toContain("[INFO] server.started");
  });

  it("reports all image findings and rejects fixable medium or higher vulnerabilities", async () => {
    const workflow = (await readFile(".github/workflows/docker-build.yml", "utf8")).replaceAll(
      "\r\n",
      "\n",
    );
    const reportStep = workflow
      .split("- name: Report all production image vulnerabilities")[1]
      ?.split("\n      - name:")[0];
    const scanStep = workflow
      .split("- name: Reject fixable production image vulnerabilities")[1]
      ?.split("\n      - name:")[0];

    expect(reportStep).toContain("fail-build: false");
    expect(reportStep).toContain("only-fixed: false");
    expect(reportStep).toContain("image-vulnerabilities.json");
    expect(scanStep).toContain("fail-build: true");
    expect(scanStep).toContain("severity-cutoff: medium");
    expect(scanStep).toContain("only-fixed: true");
    expect(scanStep).toContain("image-fixable-vulnerabilities.json");
    expect(workflow).toContain(
      "- name: Retain image inventory and vulnerability evidence\n        if: always()",
    );
    expect(
      workflow.indexOf("- name: Reject fixable production image vulnerabilities"),
    ).toBeLessThan(workflow.indexOf("- name: Publish the verified candidate without rebuilding"));
  });

  it("queues master verification and publication while cancelling superseded PR runs", async () => {
    for (const file of ["quality.yml", "docker-build.yml"]) {
      const workflow = await readFile(`.github/workflows/${file}`, "utf8");

      expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
      expect(workflow).toContain(
        "queue: ${{ github.event_name == 'pull_request' && 'single' || 'max' }}",
      );
    }
  });

  it("publishes only verified master candidates and records their immutable digest", async () => {
    const workflow = await readFile(".github/workflows/docker-build.yml", "utf8");
    const publish = workflow.split("- name: Publish the verified candidate without rebuilding")[1];

    expect(publish).toContain(
      "if: inputs.publish && github.event_name == 'push' && github.ref == 'refs/heads/master'",
    );
    expect(publish).toContain('test "$digest" = "$VERIFIED_DIGEST"');
    expect(publish).toContain('image="$IMAGE_NAME@$digest"');
    expect(publish).toContain('if [ "$master" = "$GITHUB_SHA" ]; then');
    expect(publish.indexOf('test "$digest" = "$VERIFIED_DIGEST"')).toBeLessThan(
      publish.indexOf('docker push "$IMAGE_NAME:latest"'),
    );
    expect(publish).toContain('"$VERSION" "$GITHUB_SHA" "$image" >> "$GITHUB_STEP_SUMMARY"');
  });
});
