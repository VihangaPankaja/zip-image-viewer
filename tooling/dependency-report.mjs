import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import path from "node:path";

export function createInventory(manifest, purposes, installed, licenses) {
  const direct = [];
  for (const [key, scope] of [
    ["dependencies", "runtime"],
    ["devDependencies", "development"],
  ]) {
    for (const name of Object.keys(manifest[key] || {}).sort()) {
      if (typeof purposes[name] !== "string" || !purposes[name].trim())
        throw new Error(`Missing dependency purpose: ${name}`);
      if (!installed[name]?.version) throw new Error(`Dependency is not installed: ${name}`);
      direct.push({
        name,
        package: installed[name].from || name,
        version: installed[name].version,
        scope,
        purpose: purposes[name],
      });
    }
  }
  for (const name of Object.keys(purposes)) {
    if (!direct.some((entry) => entry.name === name))
      throw new Error(`Stale dependency purpose: ${name}`);
  }
  const inventory = Object.entries(licenses)
    .flatMap(([license, entries]) =>
      entries.flatMap((entry) =>
        entry.versions.map((version) => ({ name: entry.name, version, license })),
      ),
    )
    .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  for (const entry of direct) {
    if (!inventory.some((item) => item.name === entry.package && item.version === entry.version))
      throw new Error(`Missing installed license entry: ${entry.name}@${entry.version}`);
  }
  return { direct, licenses: inventory };
}

export function readAudit(output, status) {
  const report = JSON.parse(output);
  if (
    !report ||
    !report.advisories ||
    Array.isArray(report.advisories) ||
    typeof report.advisories !== "object" ||
    !report.metadata?.vulnerabilities ||
    !Object.keys(report.metadata.vulnerabilities).length ||
    !Object.values(report.metadata.vulnerabilities).every(
      (value) => Number.isInteger(value) && value >= 0,
    )
  )
    throw new Error("Invalid audit report; check the registry/scanner output.");
  if (status !== 0 && !(status === 1 && Object.keys(report.advisories).length > 0))
    throw new Error(`Unexpected audit exit status: ${String(status)}`);
  return report;
}

if (import.meta.main) {
  const run = (args, audit = false) => {
    const result = spawnSync(process.platform === "win32" ? "vp.exe" : "vp", ["pm", ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120000,
    });
    if (result.error) throw result.error;
    if (audit) return readAudit(result.stdout, result.status);
    if (result.status !== 0)
      throw new Error(result.stderr || `vp pm failed: ${String(result.status)}`);
    return JSON.parse(result.stdout);
  };
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const purposes = JSON.parse(await readFile("tooling/dependency-purposes.json", "utf8"));
  const [installed] = run(["list", "--json", "--depth", "0"]);
  const inventory = createInventory(
    manifest,
    purposes,
    { ...installed.dependencies, ...installed.devDependencies },
    run(["licenses", "list", "--json"]),
  );
  const directory = path.resolve("test-results/dependency-maintenance");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "inventory.json"),
    JSON.stringify(inventory, null, 2) + "\n",
  );
  const audit = run(["audit", "--production", "--json"], true);
  await writeFile(
    path.join(directory, "runtime-audit.json"),
    JSON.stringify(audit, null, 2) + "\n",
  );
  const rows = Object.values(audit.advisories).map(
    (entry) =>
      `| ${entry.severity} | ${entry.module_name} | [${entry.github_advisory_id}](${entry.url}) | ${entry.patched_versions || "No published fix"} |`,
  );
  await writeFile(
    path.join(directory, "summary.md"),
    [
      "# Dependency maintenance",
      "",
      `${inventory.direct.length} direct dependencies have documented purposes. ${inventory.licenses.length} installed package versions have license metadata.`,
      "",
      "## Runtime audit triage",
      "",
      "Findings require reachability and fix review using docs/development/dependencies.md. This report does not certify that the app is vulnerability-free. Scanner failures fail the job.",
      "",
      "| Severity | Package | Advisory | Patched versions |",
      "| --- | --- | --- | --- |",
      ...rows,
      ...(rows.length ? [] : ["| None reported | | | |"]),
      "",
      "See runtime-audit.json for exact installed versions and dependency paths, inventory.json for licenses and direct purposes, and the Docker Build artifacts for image findings and SBOM.",
      "",
    ].join("\n"),
  );
  console.log(
    `Dependency reports written to ${directory}; ${rows.length} runtime advisories need triage.`,
  );
}
