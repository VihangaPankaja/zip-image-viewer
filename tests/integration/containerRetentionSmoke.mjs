import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
const { fetch } = globalThis;
import { createRetainedTorrentStore } from "../../build/server/repositories/retainedTorrents.js";
import { createJobManager } from "../../build/server/application/jobs/jobManager.js";

assert.notEqual(process.getuid(), 0, "The container must run as the app user");
const directory = path.resolve("sessions");
const probePath = path.join(directory, "retention-smoke-id");
if (process.argv[2] === "seed") {
  const store = createRetainedTorrentStore(directory);
  const manager = createJobManager(new Map(), () => {}, store);
  const job = manager.createJob(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
  manager.emitJob(job, { status: "paused", phase: "paused" });
  await mkdir(job.workspaceDir, { recursive: true });
  await writeFile(
    path.join(job.workspaceDir, "payload-marker"),
    "retained payload",
  );
  await writeFile(probePath, job.id);
  store.close();
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
  assert.equal(
    (await jobs.json()).items.find((job) => job.id === id)?.status,
    "paused",
  );
}
