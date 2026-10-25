import { createReadStream } from "node:fs";
import { lstat, open, rm, truncate, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { prepareDownloadFiles } from "./downloadFiles.js";
import { Writable } from "node:stream";
import type { HttpDownloadState } from "../../../shared/contracts.js";

export type HttpCheckpoint = {
  current?: HttpDownloadState;
  save: (_state: HttpDownloadState) => void;
};
export type HttpFileCheckpoint = HttpDownloadState["files"][number];

export function rangeValidator(metadata: { etag?: string; lastModified?: string }) {
  if (
    (metadata.etag?.length ?? 0) <= 512 &&
    /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(metadata.etag ?? "")
  )
    return metadata.etag ?? "";
  const date = metadata.lastModified ?? "";
  return date && Number.isFinite(Date.parse(date)) && new Date(date).toUTCString() === date
    ? date
    : "";
}

export async function hashDownloadFile(filename: string, bytes?: number) {
  const hash = createHash("sha256");
  if (bytes !== 0) {
    for await (const chunk of createReadStream(filename, bytes ? { end: bytes - 1 } : undefined))
      hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function checkpointPath(target: string, file: HttpFileCheckpoint) {
  return file.index === -1 ? target : `${target}.part.${file.index}`;
}

export async function reconcileHttpFiles(target: string, state: Pick<HttpDownloadState, "files">) {
  let reused = 0;
  for (const file of state.files) {
    const filename = checkpointPath(target, file);
    const info = await lstat(filename).catch(() => null);
    if (
      info?.isFile() &&
      info.size >= file.bytes &&
      file.bytes > 0 &&
      (file.end === null || file.bytes <= file.end - file.start + 1) &&
      (await hashDownloadFile(filename, file.bytes)) === file.sha256
    ) {
      if (info.size !== file.bytes) await truncate(filename, file.bytes);
      reused += file.bytes;
    } else {
      if (info?.isDirectory()) throw new Error("Download output is not a regular file.");
      await rm(filename, { force: true });
      file.bytes = 0;
      file.sha256 = "";
    }
  }
  return reused;
}

// Commit only flushed bytes; a crash may leave a suffix that reconciliation truncates.
export async function checkpointWriter(
  filename: string,
  file: HttpFileCheckpoint,
  save: () => void,
) {
  const hash = createHash("sha256");
  if (file.bytes) {
    for await (const chunk of createReadStream(filename, { end: file.bytes - 1 }))
      hash.update(chunk as Buffer);
  }
  const output = await open(filename, file.bytes ? "a" : "w");
  let bytes = file.bytes;
  let committed = bytes;
  let savedAt = Date.now();
  async function commit() {
    await output.sync();
    file.bytes = bytes;
    file.sha256 = hash.copy().digest("hex");
    save();
    committed = bytes;
    savedAt = Date.now();
  }
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      void (async () => {
        let offset = 0;
        while (offset < chunk.length) offset += (await output.write(chunk, offset)).bytesWritten;
        hash.update(chunk);
        bytes += chunk.length;
        if (bytes - committed >= 1024 * 1024 || Date.now() - savedAt >= 1_000) await commit();
      })().then(
        () => callback(),
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
      );
    },
    final(callback) {
      void commit().then(
        () => callback(),
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
      );
    },
    destroy(error, callback) {
      void (async () => {
        try {
          if (bytes !== committed) await commit();
        } finally {
          await output.close();
        }
      })().then(
        () => callback(error),
        (failure: unknown) =>
          callback(failure instanceof Error ? failure : new Error(String(failure))),
      );
    },
  });
}

export async function prepareHttpCheckpoint(
  targetPath: string,
  metadata: {
    size: number;
    acceptRanges: boolean;
    resolvedUrl?: string;
    etag?: string;
    lastModified?: string;
  },
  files: HttpDownloadState["files"],
  url: string,
  checkpoint: HttpCheckpoint | undefined,
  resume: boolean,
  segments?: { index: number; start: number; end: number }[],
) {
  const validator = rangeValidator(metadata);
  const previous = checkpoint?.current;
  const layoutMatches =
    previous?.files.length === files.length &&
    files.every(
      (file, index) =>
        file.index === previous.files[index].index &&
        file.start === previous.files[index].start &&
        file.end === previous.files[index].end,
    );
  const reusable =
    resume &&
    metadata.acceptRanges &&
    validator &&
    previous &&
    previous.originalUrl === url &&
    previous.resolvedUrl === (metadata.resolvedUrl || url) &&
    previous.size === metadata.size &&
    previous.validator === validator &&
    layoutMatches;
  const retained: HttpDownloadState = reusable
    ? structuredClone(previous)
    : {
        originalUrl: url,
        resolvedUrl: metadata.resolvedUrl || url,
        size: metadata.size,
        validator,
        files,
        completedSha256: "",
      };
  if (!reusable) await prepareDownloadFiles(targetPath, { size: metadata.size, resume: false });
  const reusedBytes = await reconcileHttpFiles(targetPath, retained);
  await prepareDownloadFiles(targetPath, {
    size: metadata.size,
    resume: true,
    segments,
  });
  await rm(`${targetPath}.assembling`, { force: true });
  const save = () => {
    checkpoint?.save(retained);
    if (checkpoint) checkpoint.current = structuredClone(retained);
  };
  save();
  return { retained, save, reusedBytes };
}

export async function verifyHttpSource(
  target: string,
  size: number,
  retained: HttpDownloadState,
  save: () => void,
) {
  const info = await stat(target);
  if (!info.isFile() || (size > 0 && info.size !== size))
    throw new Error("Download size does not match the source.");
  const file = await open(target, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  retained.completedSha256 = await hashDownloadFile(target);
  save();
  return info.size;
}
