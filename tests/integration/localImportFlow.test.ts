import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { path7za } from "7zip-bin";
import { expect, it } from "vite-plus/test";
import { runCommandCapture } from "../../server/infrastructure/process/commandRunner.js";
import { startRestartableHttpFixture, selectAllZipFiles } from "../fixtures/httpRestartServer.js";
import { zipBytes } from "../fixtures/zipBytes.js";
import type { Job } from "../../shared/contracts.js";

async function upload(
  api: Awaited<ReturnType<typeof startRestartableHttpFixture>>,
  name: string,
  contents: Buffer,
) {
  const input = { id: randomUUID(), name, size: contents.length };
  const initialized = await fetch(`${api.apiOrigin()}/api/local-imports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(initialized.status).toBe(201);
  expect(((await initialized.json()) as Job).localFile).toMatchObject({
    name,
    size: contents.length,
    complete: false,
  });
  const sent = await fetch(`${api.apiOrigin()}/api/local-imports/${input.id}/content`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array(contents),
  });
  expect(sent.status).toBe(200);
  return input;
}

it("imports local text and encrypted ZIP through real jobs, selection, password retry, restart and session reuse", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "local-flow-"));
  const api = await startRestartableHttpFixture(directory);
  const getJob = async (id: string) =>
    (await api.client.jobs.list()).items.find((job) => job.id === id) as Job;

  try {
    const text = await upload(api, "日本語 notes.txt", Buffer.from("Original local text."));
    await expect.poll(async () => (await getJob(text.id)).status).toBe("ready");
    const first = await getJob(text.id);
    expect(
      await readFile(
        path.join(directory, "sessions", text.id, "extracted", "direct", text.name),
        "utf8",
      ),
    ).toBe("Original local text.");
    const contents = path.join(directory, "contents");
    await mkdir(contents);
    await writeFile(path.join(contents, "secret.txt"), "Encrypted local contents");
    const archive = path.join(directory, "protected.zip");
    await runCommandCapture(path7za, ["a", "-tzip", "-p", archive, "."], {
      cwd: contents,
      stdin: "local-password\nlocal-password\n",
    });
    const zipped = await upload(api, "protected.zip", await readFile(archive));
    await expect.poll(async () => (await getJob(zipped.id)).status).toBe("awaiting_selection");
    await selectAllZipFiles(api.client, zipped.id);
    await expect.poll(async () => (await getJob(zipped.id)).status).toBe("awaiting_password");
    await api.client.jobs.password({ id: zipped.id, password: "wrong" });
    await expect.poll(async () => (await getJob(zipped.id)).status).toBe("awaiting_password");
    await api.client.jobs.password({ id: zipped.id, password: "local-password" });
    await expect.poll(async () => (await getJob(zipped.id)).status).toBe("ready");
    const ready = await getJob(zipped.id);
    expect(
      await readFile(
        path.join(directory, "sessions", zipped.id, "extracted", "secret.txt"),
        "utf8",
      ),
    ).toBe("Encrypted local contents");
    const pending = { id: randomUUID(), name: "interrupted.txt", size: 8 };
    await fetch(`${api.apiOrigin()}/api/local-imports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pending),
    });
    const partial = path.join(directory, "sessions", pending.id, ".uploading");
    await writeFile(partial, "partial");
    await api.restart();
    await expect.poll(async () => (await getJob(text.id)).status).toBe("ready");
    expect((await getJob(text.id)).sessionId).toBe(first.sessionId);
    await expect.poll(async () => (await getJob(zipped.id)).status).toBe("awaiting_password");
    await api.client.jobs.password({ id: zipped.id, password: "local-password" });
    await expect.poll(async () => (await getJob(zipped.id)).status).toBe("ready");
    expect((await getJob(zipped.id)).sessionId).toBe(ready.sessionId);
    expect((await api.client.sessions.list()).items).toHaveLength(2);
    expect(JSON.stringify(await api.client.jobs.list())).not.toContain("local-password");
    expect((await getJob(pending.id)).status).toBe("cancelled");
    expect(await readdir(path.join(directory, "sessions", pending.id, "source"))).toEqual([]);
    await expect(readFile(partial)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await api.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 45_000);

it("requires a new password after restarting a cancelled encrypted ZIP selection", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "local-encrypted-cancelled-"));
  const api = await startRestartableHttpFixture(directory);
  try {
    const contents = path.join(directory, "contents");
    await mkdir(contents);
    await writeFile(path.join(contents, "one.txt"), "Previously published");
    await writeFile(path.join(contents, "two.txt"), "Pending extraction");
    const archive = path.join(directory, "protected.zip");
    await runCommandCapture(path7za, ["a", "-tzip", "-p", archive, "."], {
      cwd: contents,
      stdin: "local-password\nlocal-password\n",
    });
    const { id } = await upload(api, "protected.zip", await readFile(archive));
    const job = async () => (await api.client.jobs.list()).items.find((item) => item.id === id);
    const status = async () => (await job())?.status;
    await expect.poll(status).toBe("awaiting_selection");
    const manifest = await api.client.archives.get({ id });
    const [first, second] = manifest.entries;
    await api.client.archives.select({
      id,
      fingerprint: manifest.fingerprint,
      fileIds: [first.id],
    });
    await expect.poll(status).toBe("awaiting_password");
    await api.client.jobs.password({ id, password: "local-password" });
    await expect.poll(status).toBe("ready");
    expect((await api.client.sessions.list()).items).toHaveLength(1);

    await api.client.archives.select({
      id,
      fingerprint: manifest.fingerprint,
      fileIds: [second.id],
    });
    await expect.poll(status).toBe("awaiting_password");
    await api.client.jobs.cancel({ id });
    await expect.poll(status).toBe("cancelled");
    await api.restart();

    expect(await job()).toMatchObject({ status: "cancelled", passwordProtected: true });
    expect((await api.client.sessions.list()).items).toEqual([]);
    await api.client.jobs.retry({ id });
    await expect.poll(status).toBe("awaiting_password");
    expect((await api.client.sessions.list()).items).toEqual([]);
    await api.client.jobs.password({ id, password: "local-password" });
    await expect.poll(status).toBe("ready");
    expect((await api.client.sessions.list()).items).toHaveLength(1);
    expect(await readdir(path.join(directory, "sessions", id, "extracted"))).toEqual([
      "one.txt",
      "two.txt",
    ]);
  } finally {
    await api.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 45_000);

it("rejects corrupt, escaping, colliding and oversized local ZIPs before publishing a session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "local-invalid-"));
  const api = await startRestartableHttpFixture(directory);
  try {
    const sources = [
      { name: "corrupt.zip", bytes: Buffer.from("PK damaged archive") },
      {
        name: "escape.zip",
        bytes: zipBytes([{ name: "../escape.txt", data: Buffer.from("escape") }]),
      },
      { name: "collision.zip", bytes: zipBytes([{ name: "A.txt" }, { name: "a.txt" }]) },
      {
        name: "oversized.zip",
        bytes: zipBytes(
          [1, 2, 3].map((index) => ({ name: `huge-${index}.txt`, size: 4 * 1024 ** 3 - 1 })),
        ),
      },
    ];
    for (const { name, bytes } of sources) {
      const input = await upload(api, name, bytes);
      await expect
        .poll(
          async () =>
            (await api.client.jobs.list()).items.find((job) => job.id === input.id)?.status,
        )
        .toBe("error");
    }
    expect((await api.client.sessions.list()).items).toEqual([]);
    await expect(readFile(path.join(directory, "sessions", "escape.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await api.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
