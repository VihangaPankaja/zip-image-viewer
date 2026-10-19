import path from "node:path";
import { realpath } from "node:fs/promises";

export function isWithinRoot(targetPath: string, rootPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);
}

export async function isRealPathWithinRoot(targetPath: string, rootPath: string): Promise<boolean> {
  const [target, root] = await Promise.all([realpath(targetPath), realpath(rootPath)]);
  return isWithinRoot(target, root);
}
