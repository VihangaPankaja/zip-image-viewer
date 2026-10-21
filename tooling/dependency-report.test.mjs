import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createInventory, readAudit } from "./dependency-report.mjs";

test("inventory retains exact versions and licenses while removing machine paths and resolving aliases", () => {
  const result = createInventory(
    { dependencies: { vite: "catalog:" } },
    { vite: "Client bundler" },
    { vite: { from: "@voidzero-dev/vite-plus-core", version: "1.3.0" } },
    {
      MIT: [
        { name: "@voidzero-dev/vite-plus-core", versions: ["1.3.0"], paths: ["/private/machine"] },
      ],
    },
  );
  assert.deepEqual(result.direct, [
    {
      name: "vite",
      package: "@voidzero-dev/vite-plus-core",
      version: "1.3.0",
      scope: "runtime",
      purpose: "Client bundler",
    },
  ]);
  assert.deepEqual(result.licenses, [
    { name: "@voidzero-dev/vite-plus-core", version: "1.3.0", license: "MIT" },
  ]);
  assert.equal(JSON.stringify(result).includes("/private"), false);
});

test("inventory rejects undocumented, stale and uninstalled direct dependencies", () => {
  assert.throws(() => createInventory({ dependencies: { a: "1" } }, {}, {}, {}), /purpose.*a/i);
  assert.throws(() => createInventory({}, { removed: "Old purpose" }, {}, {}), /stale.*removed/i);
  assert.throws(
    () => createInventory({ devDependencies: { a: "1" } }, { a: "Test tool" }, {}, {}),
    /installed.*a/i,
  );
  assert.throws(
    () =>
      createInventory({ dependencies: { a: "1" } }, { a: "Runtime" }, { a: { version: "1" } }, {}),
    /license.*a/i,
  );
});

test("runtime audit preserves vulnerability evidence and distinguishes findings from scanner failure", () => {
  const report = {
    advisories: {
      7: {
        github_advisory_id: "GHSA-fixture",
        module_name: "dependency",
        severity: "high",
        title: "Unsafe input",
        patched_versions: ">=2",
        url: "https://github.com/advisories/GHSA-fixture",
        findings: [{ version: "1", paths: [".>app>dependency"] }],
      },
    },
    metadata: { vulnerabilities: { high: 1 } },
  };
  assert.deepEqual(readAudit(JSON.stringify(report), 1), report);
  assert.throws(
    () => readAudit('{"error":{"message":"registry unavailable"}}', 1),
    /audit.*report/i,
  );
  assert.throws(() => readAudit(JSON.stringify(report), 2), /audit.*exit/i);
  assert.throws(() => readAudit('{"advisories":{},"metadata":{}}', 0), /audit.*report/i);
  assert.throws(
    () => readAudit('{"advisories":{},"metadata":{"vulnerabilities":{}}}', 0),
    /audit.*report/i,
  );
  assert.throws(() => readAudit("not json", 0), /JSON/);
  assert.throws(
    () => readAudit('{"advisories":{},"metadata":{"vulnerabilities":{"high":0}}}', 1),
    /audit.*exit/i,
  );
  assert.deepEqual(readAudit('{"advisories":{},"metadata":{"vulnerabilities":{"high":0}}}', 0), {
    advisories: {},
    metadata: { vulnerabilities: { high: 0 } },
  });
});
