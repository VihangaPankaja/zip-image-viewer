import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { path7za } from "7zip-bin";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";
import { startRestartableHttpFixture } from "./httpRestartServer.js";
import { workspaceProxy, closeFixtureServers } from "./proxyApp.js";

export async function startLocalImportApp(baseURL: string, slow = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "local-browser-"));
  const contents = path.join(directory, "contents");
  await mkdir(contents);
  await writeFile(path.join(contents, "notes.txt"), "Local text imported without a public URL.");
  await sharp({ create: { width: 64, height: 64, channels: 3, background: "blue" } })
    .png()
    .toFile(path.join(contents, "image.png"));
  const wav = Buffer.alloc(44 + 8_000 * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24);
  wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(path.join(contents, "audio.wav"), wav);
  const archive = path.join(directory, "collection.zip");
  await runCommand(path7za, ["a", "-tzip", archive, "."], { cwd: contents });
  const api = await startRestartableHttpFixture(directory, slow ? "local-upload" : "");
  const ui = workspaceProxy(baseURL, () => api.apiOrigin()).listen(0, "127.0.0.1");
  await once(ui, "listening");
  const address = ui.address();
  if (!address || typeof address === "string") throw new Error("Missing local UI address");
  return {
    ...api,
    directory,
    contents,
    archive,
    origin: `http://127.0.0.1:${address.port}`,
    file: (name: string) => path.join(contents, name),
    bytes: (name: string) => readFile(path.join(contents, name)),
    close: async () => {
      await api.stop();
      await closeFixtureServers([ui]);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
