import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { path7za } from "7zip-bin";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { fetch } = globalThis;
// The production build exists only after the CI dead-code check.
const builtModule = (name) => pathToFileURL(path.join(process.cwd(), "build/server", name)).href;
const { createRetainedTorrentStore } = await import(
  builtModule("repositories/retainedTorrents.js")
);
const { createJobManager } = await import(builtModule("application/jobs/jobManager.js"));

assert.notEqual(process.getuid(), 0, "The container must run as the app user");
const directory = path.resolve("sessions");
const probePath = path.join(directory, "retention-smoke-id");
const localProbe = path.join(directory, "local-import-smoke.json");
const origin = "http://127.0.0.1:8080";
const client = createORPCClient(new RPCLink({ url: `${origin}/rpc` }));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function waitForJob(id, status) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await client.jobs.list()).items.find((item) => item.id === id);
    if (job?.status === status) return job;
    assert.notEqual(job?.status, "error", job?.error);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Local import did not reach ${status}`);
}

async function importFile(name, bytes) {
  const input = { id: randomUUID(), name, size: bytes.length };
  const init = () =>
    fetch(`${origin}/api/local-imports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  assert.equal((await init()).status, 201);
  const sent = await fetch(`${origin}/api/local-imports/${input.id}/content`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
  });
  assert.equal(sent.status, 200);
  // A lost acknowledgement must never create another job or session.
  assert.equal((await init()).status, 201);
  return input.id;
}

async function seedLocalImports() {
  const text = Buffer.from("Production local import 日本語\n");
  const directId = await importFile("日本語.txt", text);
  const direct = await waitForJob(directId, "ready");
  const source = path.join(directory, "local-import-fixture");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "notes.txt"), text);
  const filename = path.join(directory, "local-encrypted.zip");
  execFileSync(path7za, ["a", "-tzip", "-p", filename, "."], {
    cwd: source,
    input: "container-local-test\ncontainer-local-test\n",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const zipId = await importFile("protected.zip", await readFile(filename));
  await waitForJob(zipId, "awaiting_selection");
  const manifest = await client.archives.get({ id: zipId });
  await client.archives.select({
    id: zipId,
    fingerprint: manifest.fingerprint,
    fileIds: manifest.entries.filter((entry) => entry.type === "file").map((entry) => entry.id),
  });
  await waitForJob(zipId, "awaiting_password");
  await client.jobs.password({ id: zipId, password: "wrong" });
  await waitForJob(zipId, "awaiting_password");
  await client.jobs.password({ id: zipId, password: "container-local-test" });
  const zip = await waitForJob(zipId, "ready");
  assert.equal(
    hash(await readFile(path.join(directory, zipId, "extracted", "notes.txt"))),
    hash(text),
  );
  await writeFile(
    localProbe,
    JSON.stringify({
      directId,
      zipId,
      directSession: direct.sessionId,
      zipSession: zip.sessionId,
      sha256: hash(text),
    }),
  );
  const oversized = await fetch(`${origin}/api/local-imports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: randomUUID(), name: "too-large.bin", size: 10 * 1024 ** 3 + 1 }),
  });
  assert.equal(oversized.status, 400);
}

async function verifyLocalImports() {
  const saved = JSON.parse(await readFile(localProbe, "utf8"));
  const direct = await waitForJob(saved.directId, "ready");
  assert.equal(direct.sessionId, saved.directSession);
  assert.equal(
    hash(await readFile(path.join(directory, direct.id, "extracted", "direct", "日本語.txt"))),
    saved.sha256,
  );
  // Restart deliberately asks again rather than persisting a password.
  await waitForJob(saved.zipId, "awaiting_password");
  await client.jobs.password({ id: saved.zipId, password: "container-local-test" });
  const zip = await waitForJob(saved.zipId, "ready");
  assert.equal(zip.sessionId, saved.zipSession);
  assert.equal(
    hash(await readFile(path.join(directory, zip.id, "extracted", "notes.txt"))),
    saved.sha256,
  );
  assert.equal(
    (await client.jobs.list()).items.filter((job) => job.sourceKind === "local").length,
    2,
  );
  assert.ok(!JSON.stringify(await client.jobs.list()).includes("container-local-test"));
}
if (process.argv[2] === "seed") {
  const store = createRetainedTorrentStore(directory);
  const manager = createJobManager(new Map(), () => {}, store);
  const job = manager.createJob(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
  manager.emitJob(job, { status: "paused", phase: "paused" });
  await mkdir(job.workspaceDir, { recursive: true });
  await writeFile(path.join(job.workspaceDir, "payload-marker"), "retained payload");
  await writeFile(probePath, job.id);
  store.close();
  await seedLocalImports();
} else {
  assert.equal(process.argv[2], "verify");
  const id = await readFile(probePath, "utf8");
  assert.equal(
    await readFile(path.join(directory, id, "payload-marker"), "utf8"),
    "retained payload",
  );
  const health = await fetch("http://127.0.0.1:8080/health");
  assert.equal((await health.json()).ready, true);
  const jobs = await fetch("http://127.0.0.1:8080/api/session-jobs");
  assert.equal(jobs.status, 200);
  assert.equal((await jobs.json()).items.find((job) => job.id === id)?.status, "paused");
  await verifyLocalImports();
}
