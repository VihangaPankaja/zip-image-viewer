import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

async function reusableDownloadBytes(filePath: string, size: number, resume: boolean) {
  const file = await lstat(filePath).catch(() => null);
  if (file && !file.isFile() && !file.isSymbolicLink())
    throw Object.assign(new Error("Download output path is not a regular file."), {
      code: "DOWNLOAD_FATAL",
    });
  if (resume && file?.isFile() && file.size <= size) return file.size;
  await rm(filePath, { force: true });
  return 0;
}

export async function prepareDownloadFiles(
  targetPath: string,
  options: {
    size: number;
    resume: boolean;
    segments?: { index: number; start: number; end: number }[];
  },
) {
  const prefix = `${path.basename(targetPath)}.part.`;
  const parts = new Map(
    options.segments?.map((segment) => [
      `${prefix}${segment.index}`,
      segment.end - segment.start + 1,
    ]),
  );
  let reused = await reusableDownloadBytes(
    targetPath,
    options.size,
    options.resume && !options.segments,
  );
  for (const name of await readdir(path.dirname(targetPath))) {
    if (!name.startsWith(prefix) || !/^(?:0|[1-9]\d*)$/.test(name.slice(prefix.length))) continue;
    const size = parts.get(name);
    reused += await reusableDownloadBytes(
      path.join(path.dirname(targetPath), name),
      size ?? 0,
      options.resume && size !== undefined,
    );
  }
  return reused;
}
