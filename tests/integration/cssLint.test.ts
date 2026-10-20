import { spawnSync } from "node:child_process";
import stylelint from "stylelint";
import { expect, it } from "vite-plus/test";

async function lint(code: string, filename = "client/src/styles/lint-fixture.css") {
  const result = await stylelint.lint({
    code,
    codeFilename: filename,
    configFile: "stylelint.config.mjs",
  });
  return {
    status: result.errored ? 2 : 0,
    diagnostics: JSON.stringify(result.results.flatMap((item) => item.warnings)),
  };
}

it("rejects CSS errors and unsafe selector cascades", async () => {
  const result = await lint(`
@medai screen {}
.panel:unknown-state {
  colr: var(--text);
  color: var(--text);
  color: var(--accent);
  width: nope;
}
#workspace .panel { display: block; }
.panel { display: flex; }
`);
  expect(result.status).toBe(2);
  for (const rule of [
    "at-rule-no-unknown",
    "selector-pseudo-class-no-unknown",
    "property-no-unknown",
    "declaration-block-no-duplicate-properties",
    "declaration-property-value-no-unknown",
    "selector-max-id",
    "no-descending-specificity",
  ])
    expect(result.diagnostics).toContain(rule);
}, 30_000);

it("returns a failing CLI exit code for invalid CSS and raw component colors", () => {
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/stylelint/bin/stylelint.mjs",
      "--stdin",
      "--stdin-filename",
      "client/src/styles/lint-fixture.css",
      "--max-warnings",
      "0",
    ],
    { input: ".fixture { color: #fff; colr: red; }", encoding: "utf8", timeout: 60_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(2);
  expect(result.stdout + result.stderr).toContain("color-no-hex");
  expect(result.stdout + result.stderr).toContain("property-no-unknown");
}, 90_000);

it.each([
  "color: #fff",
  "background: rgb(0 0 0 / 75%)",
  "border: 1px solid red",
  "box-shadow: 0 0 2px hsl(0 0% 0%)",
  "--local-color: oklch(60% 0.2 120)",
  "color: var(--text, white)",
  "background: color-mix(in srgb, var(--bg) 90%, #fff)",
])("rejects component palette literals in %s", async (declaration) => {
  const result = await lint(`.panel { ${declaration}; }`);
  expect(result.status).toBe(2);
  expect(result.diagnostics).toMatch(/color-no-hex|color-named|function-disallowed-list/);
});

it("accepts semantic tokens, token mixtures and platform colors", async () => {
  expect(
    (
      await lint(`.panel {
  color: var(--text);
  background: color-mix(in srgb, var(--bg-panel) 90%, transparent);
  border: 1px solid currentcolor;
  box-shadow: var(--shadow);
}
@media (forced-colors: active) {
  .panel { outline-color: Highlight; }
}`)
    ).status,
  ).toBe(0);
});

it("allows palette definitions only in the token stylesheet", async () => {
  expect((await lint(":root { --accent: #5ed4c4; }", "client/src/styles/tokens.css")).status).toBe(
    0,
  );
  expect((await lint(":root { --accent: #5ed4c4; }")).status).toBe(2);
});

it("parses roadmap HTML and reports embedded CSS errors without linting script text", async () => {
  const html = `<html><head><style>.card { color: #fff; }</style></head>
<body><script>const message = "not { CSS";</script></body></html>`;
  expect((await lint(html, "docs/app-roadmap.html")).status).toBe(0);
  const invalid = await lint(html.replace("color:", "colr:"), "docs/app-roadmap.html");
  expect(invalid.status).toBe(2);
  expect(invalid.diagnostics).toContain("property-no-unknown");
});
