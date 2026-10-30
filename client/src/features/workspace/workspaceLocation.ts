import { workspaceLocationSchema, type WorkspaceLocation } from "../../../../shared/contracts";
import { SORT_OPTIONS } from "../../lib/appConstants";

export function readWorkspaceLocation(hash: string): WorkspaceLocation {
  try {
    const raw = new URLSearchParams(hash.slice(1)).get("workspace");
    if (raw && raw.length > 100_000) throw new Error("Location is too large.");
    const parsed = workspaceLocationSchema.parse(raw ? JSON.parse(raw) : {});
    if (!SORT_OPTIONS.some(({ value }) => value === parsed.sort)) parsed.sort = "natural-tail";
    return parsed;
  } catch {
    return workspaceLocationSchema.parse({});
  }
}

export function workspaceHash(location: WorkspaceLocation): string {
  return `#${new URLSearchParams({ workspace: JSON.stringify(location) })}`;
}
