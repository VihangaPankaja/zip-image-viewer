import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";
import { startHttpRestartServer, stopHttpRestartServer } from "./httpRestartServer.js";
import { workspaceProxy } from "./proxyApp.js";

export const zipSelectionNames = [
  "album/一枚目-a-long-filename-for-testing-selection-without-clipped-actions.txt",
  "album/second.txt",
  "leave-compressed.txt",
];

export async function startZipSelectionApp(baseURL: string, nested = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "zip-browser-"));
  const contents = path.join(directory, "contents");
  await mkdir(path.join(contents, "album"), { recursive: true });
  for (const [index, filename] of zipSelectionNames.entries())
    await writeFile(path.join(contents, filename), `Selected file ${index}`);
  if (nested) {
    const inner = path.join(directory, "inner");
    await mkdir(inner);
    await writeFile(path.join(inner, "read-me.txt"), "Text inside a selected nested 7z archive.");
    await writeFile(path.join(inner, "leave-inside.txt"), "This entry must stay compressed.");
    await runCommand(path7za, ["a", "-t7z", path.join(contents, "inside.7z"), "."], { cwd: inner });
  }
  const archive = path.join(directory, "collection.zip");
  await runCommand(path7za, ["a", "-tzip", archive, "."], { cwd: contents });
  const payload = await readFile(archive);
  let requests = 0;
  const source = createServer((request, response) => {
    response.writeHead(200, { "content-length": payload.length });
    if (request.method === "HEAD") response.end();
    else {
      requests++;
      response.end(payload);
    }
  });
  source.listen(0, "127.0.0.1");
  await once(source, "listening");
  const sourceAddress = source.address();
  if (!sourceAddress || typeof sourceAddress === "string") throw new Error("Missing source port");
  let api = await startHttpRestartServer(directory);
  const app = workspaceProxy(baseURL, () => api.origin);
  const ui = app.listen(0, "127.0.0.1");
  await once(ui, "listening");
  const address = ui.address();
  if (!address || typeof address === "string") throw new Error("Missing UI port");
  const { items } = await api.client.jobs.enqueue({
    items: [
      {
        url: `http://download.example:${sourceAddress.port}/collection.zip`,
        downloadOptions: { retry: { maxRetries: 0 } },
      },
    ],
  });
  return {
    origin: `http://127.0.0.1:${address.port}`,
    directory,
    id: items[0].id,
    get requests() {
      return requests;
    },
    get client() {
      return api.client;
    },
    restart: async () => {
      await stopHttpRestartServer(api.child, true);
      api = await startHttpRestartServer(directory);
    },
    close: async () => {
      await stopHttpRestartServer(api.child, true);
      source.closeAllConnections();
      ui.closeAllConnections();
      for (const server of [source, ui])
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
