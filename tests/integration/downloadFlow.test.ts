import { createServer } from "node:http";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebTorrent, { type Torrent } from "webtorrent";
import { createJobManager } from "../../server/application/jobs/jobManager.js";
import { createProcessSessionJob } from "../../server/application/jobs/processSessionJob.js";
import { createSessionJobQueue } from "../../server/application/jobs/sessionJobQueue.js";
import { createWebTorrentAdapter } from "../../server/application/torrents/torrentDownloader.js";
import { createRuntimeApp } from "../../server/bootstrap/createRuntimeApp.js";
import { CONFIRM_SIZE_BYTES } from "../../server/config/runtimeConstants.js";
import type { Session, SessionJob } from "../../server/domain/models.js";
import { listExtractedEntries } from "../../server/infrastructure/archive/listExtractedEntries.js";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";
import {
  downloadRuntimeSource,
  extractRuntimeArchive,
} from "../../server/runtimeAdapters.js";
import { serverContract } from "../../shared/contracts.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

async function waitUntil(predicate: () => boolean, changes: EventEmitter) {
  while (!predicate()) await once(changes, "change");
}

describe("real download flows", () => {
  it("downloads exact ZIP bytes over HTTP ranges and extracts their contents", async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "ziv-http-source-"));
    cleanupPaths.push(fixtureRoot);
    const sourceDirectory = path.join(fixtureRoot, "source", "album");
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    const expectedFile = Buffer.from(
      Array.from({ length: 4_097 }, (_, index) => (index * 31) % 256),
    );
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(path.join(sourceDirectory, "pixels.bin"), expectedFile);
    await runCommand(path7za, ["a", "-tzip", archivePath, "."], {
      cwd: path.join(fixtureRoot, "source"),
    });
    const archiveBytes = await readFile(archivePath);
    const source = createServer((request, response) => {
      const headers = {
        "accept-ranges": "bytes",
        "content-length": archiveBytes.length,
      };
      if (request.method === "HEAD") {
        response.writeHead(200, headers).end();
        return;
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      if (!match) {
        response.writeHead(200, headers).end(archiveBytes);
        return;
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      const body = archiveBytes.subarray(start, end + 1);
      response
        .writeHead(206, {
          "accept-ranges": "bytes",
          "content-length": body.length,
          "content-range": `bytes ${String(start)}-${String(end)}/${String(archiveBytes.length)}`,
        })
        .end(body);
    });
    source.listen(0, "127.0.0.1");
    await once(source, "listening");
    const address = source.address();
    if (!address || typeof address === "string") {
      throw new Error("HTTP fixture server did not bind to a TCP port.");
    }
    const jobs = new Map<string, SessionJob>();
    const sessions = new Map<string, Session>();
    const manager = createJobManager(jobs, vi.fn());
    const job = manager.createJob(
      `http://127.0.0.1:${String(address.port)}/fixture.zip`,
    );
    try {
      const processJob = createProcessSessionJob({
        sessionStore: sessions,
        emitJob: manager.emitJob,
        closeJob: manager.closeJob,
        download: downloadRuntimeSource,
        detectEncryption: () => Promise.resolve(false),
        extractWith7zip: (archive, output) =>
          extractRuntimeArchive(path7za, archive, output),
        listExtractedEntries,
        logEvent: vi.fn(),
        torrentAdapter: { download: vi.fn(), close: vi.fn() },
      });

      await processJob(job);

      expect(job.status).toBe("ready");
      expect(job.downloadedBytes).toBe(archiveBytes.length);
      const session = [...sessions.values()][0];
      expect(session).toBeDefined();
      expect(
        await readFile(path.join(session.workspaceDir, "fixture.zip")),
      ).toEqual(archiveBytes);
      expect(
        await readFile(path.join(session.extractDir, "album", "pixels.bin")),
      ).toEqual(expectedFile);
    } finally {
      if (job.workspaceDir) cleanupPaths.push(job.workspaceDir);
      cleanupPaths.push(
        ...Array.from(sessions.values(), ({ workspaceDir }) => workspaceDir),
      );
      await new Promise<void>((resolve, reject) =>
        source.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("downloads a magnet from a directly addressed localhost peer", async () => {
    const fixtureRoot = await mkdtemp(
      path.join(tmpdir(), "ziv-torrent-source-"),
    );
    cleanupPaths.push(fixtureRoot);
    const sourcePath = path.join(fixtureRoot, "fixture.bin");
    const expectedFile = Buffer.from(
      Array.from({ length: 32_769 }, (_, index) => (index * 17) % 256),
    );
    await writeFile(sourcePath, expectedFile);
    const seeder = new WebTorrent({
      dht: false,
      lsd: false,
      tracker: false,
      utp: false,
    });
    const adapter = createWebTorrentAdapter();
    const sessions = new Map<string, Session>();
    let job: SessionJob | undefined;
    try {
      const torrent = await new Promise<Torrent>((resolve, reject) => {
        seeder.once("error", reject);
        seeder.seed(
          sourcePath,
          { announce: [], private: true },
          (readyTorrent) => resolve(readyTorrent),
        );
      });
      const magnet = `${torrent.magnetURI}&x.pe=127.0.0.1:${String(seeder.torrentPort)}`;
      const jobs = new Map<string, SessionJob>();
      const manager = createJobManager(jobs, vi.fn());
      job = manager.createJob(magnet);
      const processJob = createProcessSessionJob({
        sessionStore: sessions,
        emitJob: manager.emitJob,
        closeJob: manager.closeJob,
        download: downloadRuntimeSource,
        detectEncryption: () => Promise.resolve(false),
        extractWith7zip: (archive, output) =>
          extractRuntimeArchive(path7za, archive, output),
        listExtractedEntries,
        logEvent: vi.fn(),
        torrentAdapter: adapter,
      });

      await processJob(job);

      expect(job.status).toBe("ready");
      expect(job.downloadedBytes).toBe(expectedFile.length);
      const session = [...sessions.values()][0];
      expect(session).toBeDefined();
      expect(
        await readFile(path.join(session.extractDir, "fixture.bin")),
      ).toEqual(expectedFile);
    } finally {
      if (job?.workspaceDir) cleanupPaths.push(job.workspaceDir);
      cleanupPaths.push(
        ...Array.from(sessions.values(), ({ workspaceDir }) => workspaceDir),
      );
      await adapter.close();
      await new Promise<void>((resolve, reject) =>
        seeder.destroy((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 20_000);

  it("confirms an oversized URL through RPC and completes the queued download", async () => {
    const fixtureRoot = await mkdtemp(
      path.join(tmpdir(), "ziv-confirm-source-"),
    );
    cleanupPaths.push(fixtureRoot);
    const sourceDirectory = path.join(fixtureRoot, "source", "album");
    const archivePath = path.join(fixtureRoot, "oversized.zip");
    const expectedFile = Buffer.from("confirmed archive contents");
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(path.join(sourceDirectory, "confirmed.txt"), expectedFile);
    await runCommand(path7za, ["a", "-tzip", archivePath, "."], {
      cwd: path.join(fixtureRoot, "source"),
    });
    const archiveBytes = await readFile(archivePath);
    const source = createServer((request, response) => {
      if (request.method === "HEAD") {
        response
          .writeHead(200, { "content-length": CONFIRM_SIZE_BYTES + 1 })
          .end();
        return;
      }
      response
        .writeHead(200, { "content-length": archiveBytes.length })
        .end(archiveBytes);
    });
    source.listen(0, "127.0.0.1");
    await once(source, "listening");
    const sourceAddress = source.address();
    if (!sourceAddress || typeof sourceAddress === "string") {
      throw new Error("Confirmation fixture server did not bind.");
    }
    const jobs = new Map<string, SessionJob>();
    const sessions = new Map<string, Session>();
    const manager = createJobManager(jobs, vi.fn());
    const changes = new EventEmitter();
    const emitJob: typeof manager.emitJob = (...args) => {
      manager.emitJob(...args);
      changes.emit("change");
    };
    let activeCount = 0;
    const pending: Parameters<
      typeof createSessionJobQueue
    >[0]["pendingSessionJobs"] = [];
    let queue: ReturnType<typeof createSessionJobQueue>;
    const processJob = createProcessSessionJob({
      sessionStore: sessions,
      emitJob,
      closeJob: manager.closeJob,
      download: downloadRuntimeSource,
      detectEncryption: () => Promise.resolve(false),
      extractWith7zip: (archive, output) =>
        extractRuntimeArchive(path7za, archive, output),
      listExtractedEntries,
      logEvent: vi.fn(),
      torrentAdapter: { download: vi.fn(), close: vi.fn() },
    });
    queue = createSessionJobQueue({
      pendingSessionJobs: pending,
      getActiveSessionJobCount: () => activeCount,
      incrementActiveSessionJobCount: () => {
        activeCount += 1;
      },
      decrementActiveSessionJobCount: () => {
        activeCount -= 1;
        changes.emit("change");
      },
      maxActiveSessionJobs: 1,
      processSessionJob: processJob,
      logEvent: vi.fn(),
    });
    const app = createRuntimeApp({
      metrics: {
        getSessionCount: () => sessions.size,
        getJobCount: () => jobs.size,
      },
      distDir: path.resolve("dist"),
      jobs,
      sessions,
      sanitizeJob: (job) => ({
        ...manager.sanitizeJob(job),
        url: "https://example.com/oversized.zip",
      }),
      createJob: manager.createJob,
      enqueueJob: queue.enqueueSessionJob,
      confirmJob: queue.confirmSessionJob,
      listOrderedJobs: queue.getOrderedJobs,
      pauseJob: queue.pauseSessionJob,
      resumeJob: queue.resumeSessionJob,
      cancelJob: (job) => queue.cancelSessionJob(job.id),
      retryJob: (job) => job,
      removeJob: (id) => {
        queue.removeSessionJob(id);
        return Promise.resolve();
      },
      reorderJobs: queue.reorderSessionJobs,
      getSchedulerSettings: queue.getSchedulerState,
      updateSchedulerSettings: queue.setMaxActiveSessionJobs,
      removeSession: () => Promise.resolve(),
    });
    const rpcServer = app.listen(0, "127.0.0.1");
    await once(rpcServer, "listening");
    const rpcAddress = rpcServer.address();
    if (!rpcAddress || typeof rpcAddress === "string") {
      throw new Error("Confirmation RPC server did not bind.");
    }
    let job: SessionJob | undefined;
    try {
      const createdJob = manager.createJob(
        `http://127.0.0.1:${String(sourceAddress.port)}/oversized.zip`,
      );
      job = createdJob;
      queue.enqueueSessionJob(createdJob, false);
      await waitUntil(
        () => createdJob.status === "awaiting_confirmation",
        changes,
      );
      expect(createdJob.requiresConfirmation).toBe(true);
      const rpc = createORPCClient<ContractRouterClient<typeof serverContract>>(
        new RPCLink({ url: `http://127.0.0.1:${String(rpcAddress.port)}/rpc` }),
      );

      await expect(
        rpc.jobs.confirm({ id: createdJob.id }),
      ).resolves.toMatchObject({
        status: "queued",
        phase: "queued",
        message: "Confirmation accepted. Waiting to start.",
        requiresConfirmation: false,
      });
      await waitUntil(() => createdJob.status === "ready", changes);
      await waitUntil(() => activeCount === 0, changes);

      const session = [...sessions.values()][0];
      expect(session).toBeDefined();
      cleanupPaths.push(session.workspaceDir);
      expect(
        await readFile(path.join(session.extractDir, "album", "confirmed.txt")),
      ).toEqual(expectedFile);
    } finally {
      if (job?.workspaceDir) cleanupPaths.push(job.workspaceDir);
      await new Promise<void>((resolve, reject) =>
        rpcServer.close((error) => (error ? reject(error) : resolve())),
      );
      await new Promise<void>((resolve, reject) =>
        source.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 20_000);
});
