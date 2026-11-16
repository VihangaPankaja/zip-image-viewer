import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import {
  runCommand,
  runCommandCapture,
} from "../../server/infrastructure/process/commandRunner.js";
import { startRestartableHttpFixture } from "./httpRestartServer.js";
import { workspaceProxy, closeFixtureServers } from "./proxyApp.js";

export async function startArchiveVolumesApp(
  frontend?: string,
  omitLast = true,
  password?: string,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "volume-browser-"));
  const input = path.join(directory, "input");
  await mkdir(input);
  await writeFile(path.join(input, "日本語.txt"), Buffer.alloc(2048, 65));
  const create = password
    ? (command: string, args: string[], options: { cwd: string }) =>
        runCommandCapture(command, [...args.slice(0, 1), "-p", "-mhe=on", ...args.slice(1)], {
          ...options,
          stdin: `${password}\n${password}\n`,
        })
    : runCommand;
  await create(
    path7za,
    ["a", "-t7z", "-mx=0", "-v1k", path.join(directory, "collection.7z"), "."],
    { cwd: input },
  );
  const names = (await readdir(directory))
    .filter((name) => /^collection\.7z\.\d+$/.test(name))
    .sort();
  const requests = new Map<string, number>();
  const source = createServer((request, response) => {
    const name = request.url?.slice(1) ?? "";
    if (!names.includes(name)) {
      response.writeHead(404).end();
      return;
    }
    void readFile(path.join(directory, name)).then((payload) => {
      response.writeHead(200, {
        "content-length": payload.length,
        etag: '"v1"',
        "accept-ranges": "bytes",
      });
      if (request.method === "HEAD") response.end();
      else {
        requests.set(name, (requests.get(name) ?? 0) + 1);
        response.end(payload);
      }
    });
  });
  source.listen(0, "127.0.0.1");
  await once(source, "listening");
  const address = source.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const url = (name: string) => `http://download.example:${address.port}/${name}`;
  const api = await startRestartableHttpFixture(directory);
  const ui = frontend
    ? workspaceProxy(frontend, () => api.apiOrigin()).listen(0, "127.0.0.1")
    : undefined;
  if (ui) await once(ui, "listening");
  const uiAddress = ui?.address();
  const { items } = await api.client.jobs.enqueue({
    items: (omitLast ? names.slice(0, -1) : [...names]).reverse().map((name) => ({
      url: url(name),
      downloadOptions: {
        transport: { mode: "single", multithread: false },
        retry: { maxRetries: 0 },
      },
    })),
  });
  return Object.assign(api, {
    directory,
    items,
    names,
    requests,
    url,
    origin:
      uiAddress && typeof uiAddress !== "string"
        ? `http://127.0.0.1:${uiAddress.port}`
        : api.apiOrigin(),
    close: async () => {
      await api.stop();
      await closeFixtureServers([ui, source]);
      await rm(directory, { recursive: true, force: true });
    },
  });
}
