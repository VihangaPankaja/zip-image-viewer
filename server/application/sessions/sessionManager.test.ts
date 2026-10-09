import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { Session } from "../../domain/models.js";
import { createSessionManager } from "./sessionManager.js";

it("keeps retained originals through viewer close, expiry and shutdown until explicit removal", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "retained-cleanup-"));
  const session: Session = {
    id: "retained", retained: true, workspaceDir, extractDir: workspaceDir,
    tree: { name: "root", path: ".", type: "directory", modifiedAt: 0 },
    firstFilePath: "", stats: { fileCount: 0 }, selectedVideoQuality: "original",
    transcodeStatus: { quality: "original", done: true, completed: 0, total: 0 },
    lastAccessedAt: 0,
  };
  const sessions = new Map([[session.id, session]]);
  const cleanup = vi.fn(() => Promise.resolve());
  const manager = createSessionManager(sessions, new Map(), vi.fn(), cleanup);
  try {
    await manager.removeSession(session.id, "viewer");
    await manager.removeSession(session.id, "expired");
    expect(cleanup).not.toHaveBeenCalled();
    await manager.removeSession(session.id, "shutdown");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(manager.touchSession(session.id)).toBe(session);
    expect((await stat(workspaceDir)).isDirectory()).toBe(true);
    await manager.removeSession(session.id);
    expect(sessions.size).toBe(0);
    await expect(stat(workspaceDir)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

it("rejects new session access and drains media work before deleting its files", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "media-cleanup-"));
  const session: Session = {
    id: "session", workspaceDir, extractDir: workspaceDir,
    tree: { name: "root", path: ".", type: "directory", modifiedAt: 0 },
    firstFilePath: "", stats: { fileCount: 0 }, selectedVideoQuality: "original",
    transcodeStatus: { quality: "original", done: true, completed: 0, total: 0 },
    lastAccessedAt: 0,
  };
  const sessions = new Map([[session.id, session]]);
  let finish = () => {};
  const drained = new Promise<void>((resolve) => { finish = resolve; });
  const cleanup = vi.fn(async () => {
    expect(sessions.has(session.id)).toBe(false);
    expect((await stat(workspaceDir)).isDirectory()).toBe(true);
    await drained;
  });
  const manager = createSessionManager(sessions, new Map(), vi.fn(), cleanup);
  try {
    const removal = manager.removeSession(session.id);
    expect(cleanup).toHaveBeenCalledWith(session);
    expect(manager.touchSession(session.id)).toBeUndefined();
    expect((await stat(workspaceDir)).isDirectory()).toBe(true);
    finish();
    await removal;
    await expect(stat(workspaceDir)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    finish();
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
