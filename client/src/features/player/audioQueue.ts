import { buildFileUrl } from "../../lib/fileUrl";
import { classifyNodeKind } from "../../lib/mimeTypeSystem";
import type { PreviewNode } from "../workspace/types";

export type AudioTrack = {
  path: string;
  name: string;
  url: string;
  album: string;
  artwork: string;
};

export function buildAudioQueue(sessionId: string, files: readonly PreviewNode[]): AudioTrack[] {
  const covers = new Map<string, string>();
  for (const file of files) {
    if (file.type === "file" && /^(cover|folder|front)\.(jpe?g|png|webp)$/i.test(file.name)) {
      const folder = file.path.slice(0, file.path.lastIndexOf("/") + 1);
      if (!covers.has(folder)) covers.set(folder, file.path);
    }
  }
  return files
    .filter((file) => classifyNodeKind(file) === "audio")
    .map((file) => {
      const folder = file.path.slice(0, file.path.lastIndexOf("/") + 1);
      const cover = covers.get(folder);
      return {
        path: file.path,
        name: file.name,
        url: buildFileUrl(sessionId, file.path),
        album: folder.replace(/\/$/, "").split("/").at(-1) || "Audio",
        artwork: cover ? buildFileUrl(sessionId, cover, { thumbnail: true, size: 160 }) : "",
      };
    });
}

export function shuffleAudioQueue(
  tracks: readonly AudioTrack[],
  currentPath: string,
): AudioTrack[] {
  const remaining = tracks.filter((track) => track.path !== currentPath);
  for (let index = remaining.length - 1; index > 0; index--) {
    const next = Math.floor(Math.random() * (index + 1));
    [remaining[index], remaining[next]] = [remaining[next], remaining[index]];
  }
  const current = tracks.find((track) => track.path === currentPath);
  return current ? [current, ...remaining] : remaining;
}

export function audioTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
