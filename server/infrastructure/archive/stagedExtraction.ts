import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";

export async function stageExtraction<Result>(
  directory: string,
  extract: (_staging: string) => Promise<Result>,
): Promise<Result> {
  const staging = `${directory}.staging`;
  const previous = `${directory}.previous`;
  if (existsSync(previous)) {
    if (existsSync(directory)) await rm(previous, { recursive: true, force: true });
    else await rename(previous, directory);
  }
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const result = await extract(staging);
    const hadPrevious = existsSync(directory);
    if (hadPrevious) await rename(directory, previous);
    try {
      await rename(staging, directory);
    } catch (error) {
      if (hadPrevious) await rename(previous, directory);
      throw error;
    }
    await rm(previous, { recursive: true, force: true });
    return result;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
