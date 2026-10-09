import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { jobSchema } from "../../shared/contracts.js";
import { z } from "zod";
import { sanitizeEntryPath } from "../infrastructure/runtime/runtimePrimitives.js";
import type { SessionJob } from "../domain/models.js";

export function createRetainedTorrentStore(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, "torrents.sqlite");
  const database = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS torrents (
      id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, metadata BLOB
    );
  `);
  const save = database.prepare(
    "INSERT INTO torrents VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot, metadata = excluded.metadata",
  );
  const remove = database.prepare("DELETE FROM torrents WHERE id = ?");
  return {
    directory,
    save(job: SessionJob) {
      if (job.sourceKind !== "torrent") return;
      const snapshot = {
        ...jobSchema.parse(job),
        downloadOptions: job.downloadOptions,
        torrentArchivePath: job.torrentArchivePath,
      };
      database.exec("BEGIN IMMEDIATE");
      try {
        save.run(job.id, JSON.stringify(snapshot), job.torrentMetadata ?? null);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    read() {
      return database
        .prepare("SELECT snapshot, metadata FROM torrents ORDER BY rowid")
        .all()
        .map((row) => ({
          job: jobSchema
            .extend({
              downloadOptions: z.unknown(),
              torrentArchivePath: z
                .string()
                .transform(sanitizeEntryPath)
                .optional(),
            })
            .parse(JSON.parse(String(row.snapshot))),
          metadata:
            row.metadata instanceof Uint8Array ? row.metadata : undefined,
        }))
        .sort(
          (left, right) => left.job.queuePosition - right.job.queuePosition,
        );
    },
    remove(id: string) {
      remove.run(id);
    },
    close() {
      database.close();
    },
  };
}

export type RetainedTorrentStore = ReturnType<
  typeof createRetainedTorrentStore
>;
