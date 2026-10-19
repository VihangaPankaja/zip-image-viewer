import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vite-plus/test";

it("rejects invalid async, unsafe, union, hook and test code through vp lint", async () => {
  const parent = path.resolve("tests/tooling");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, ".lint-fixture-"));
  try {
    const file = path.join(directory, "invalid.test.ts");
    await writeFile(
      file,
      `import { useEffect, useState } from "react";
import { expect, it } from "vite-plus/test";
export function floating() { Promise.resolve(1); }
export const misused: () => void = async () => { await Promise.resolve(); };
export function unsafe(input: any) { const value: number = input; return value; }
export function incomplete(mode: "one" | "two") {
  switch (mode) { case "one": return 1; }
}
export function useConditional(enabled: boolean) {
  if (enabled) useState(0);
  useEffect(() => { console.log(enabled); }, []);
}
it.only("focused", () => { expect(Promise.resolve(1)).resolves.toBe(1); });
`,
    );
    const result = spawnSync(process.execPath, ["node_modules/vite-plus/bin/vp", "lint", file], {
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const diagnostics = result.stdout + result.stderr;
    for (const rule of [
      "no-floating-promises",
      "no-misused-promises",
      "no-unsafe-assignment",
      "switch-exhaustiveness-check",
      "rules-of-hooks",
      "exhaustive-deps",
      "no-focused-tests",
      "valid-expect",
    ])
      expect(diagnostics).toContain(rule);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 90_000);
