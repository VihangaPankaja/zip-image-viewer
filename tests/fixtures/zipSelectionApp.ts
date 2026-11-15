import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import {
  runCommand,
  runCommandCapture,
} from "../../server/infrastructure/process/commandRunner.js";
import { startRestartableHttpFixture } from "./httpRestartServer.js";
import { workspaceProxy, closeFixtureServers } from "./proxyApp.js";

export const zipSelectionNames = [
  "album/一枚目-a-long-filename-for-testing-selection-without-clipped-actions.txt",
  "album/second.txt",
  "leave-compressed.txt",
];

export async function startZipSelectionApp(
  baseURL: string,
  nested = false,
  pausedExtraction = false,
  encryption?: { password: string; type?: "zip" | "7z"; headers?: boolean; nestedOnly?: boolean },
) {
  const directory = await mkdtemp(path.join(tmpdir(), "zip-browser-"));
  const contents = path.join(directory, "contents");
  await mkdir(path.join(contents, "album"), { recursive: true });
  for (const [index, filename] of zipSelectionNames.entries())
    await writeFile(
      path.join(contents, filename),
      pausedExtraction && index === 0
        ? Buffer.alloc(4 * 1024 * 1024, 65)
        : `Selected file ${index}`,
    );
  if (nested) {
    const inner = path.join(directory, "inner");
    await mkdir(inner);
    await writeFile(path.join(inner, "read-me.txt"), "Text inside a selected nested 7z archive.");
    await writeFile(path.join(inner, "leave-inside.txt"), "This entry must stay compressed.");
    await createArchive(path.join(contents, "inside.7z"), inner, "7z", encryption);
  }
  const format = encryption?.type ?? "zip";
  const name = `collection.${format}`;
  const archive = path.join(directory, name);
  await createArchive(archive, contents, format, encryption?.nestedOnly ? undefined : encryption);
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
  const api = await startRestartableHttpFixture(
    directory,
    pausedExtraction ? "paused-extraction" : "",
  );
  const app = workspaceProxy(baseURL, () => api.apiOrigin());
  const ui = app.listen(0, "127.0.0.1");
  await once(ui, "listening");
  const address = ui.address();
  if (!address || typeof address === "string") throw new Error("Missing UI port");
  const { items } = await api.client.jobs.enqueue({
    items: [
      {
        url: `http://download.example:${sourceAddress.port}/${name}`,
        downloadOptions: { retry: { maxRetries: 0 } },
      },
    ],
  });
  return Object.assign(api, {
    origin: `http://127.0.0.1:${address.port}`,
    directory,
    id: items[0].id,
    get requests() {
      return requests;
    },
    close: async () => {
      await api.stop();
      await closeFixtureServers([source, ui]);
      await rm(directory, { recursive: true, force: true });
    },
  });
}

async function createArchive(
  filename: string,
  cwd: string,
  type: string,
  encryption?: { password: string; headers?: boolean },
) {
  const args = [
    "a",
    `-t${type}`,
    ...(encryption ? ["-p", ...(type === "7z" && encryption.headers ? ["-mhe=on"] : [])] : []),
    filename,
    ".",
  ];
  if (encryption)
    await runCommandCapture(path7za, args, {
      cwd,
      stdin: `${encryption.password}\n${encryption.password}\n`,
    });
  else await runCommand(path7za, args, { cwd });
}
