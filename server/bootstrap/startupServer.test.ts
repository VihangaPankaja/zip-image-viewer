import { expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./createApp.js";
import { createStartupServer } from "./startupServer.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

it("serves liveness while blocking application requests until restore finishes", async () => {
  const { server, setApp } = createStartupServer(() => {});
  expect(
    (await request(server).get("/health?probe=1").expect(200)).body,
  ).toEqual({
    ok: true,
    ready: false,
  });
  await request(server).head("/health").expect(200);
  for (const route of [
    "/rpc/jobs",
    "/api/session-jobs",
    "/api/sessions/id/raw",
    "/",
  ]) {
    await request(server).get(route).expect(503).expect("Retry-After", "1");
  }
  await request(server).post("/health").expect(503);
  await request(server)
    .get("/events")
    .set("Connection", "Upgrade")
    .set("Upgrade", "websocket")
    .expect(503);
  setApp(
    createApp({
      getSessionCount: () => 0,
      getJobCount: () => 0,
      listJobs: () => [],
      listSessions: () => [],
    }),
  );
  expect((await request(server).get("/health").expect(200)).body).toEqual({
    ok: true,
    ready: true,
    sessions: 0,
    jobs: 0,
  });
  await request(server).get("/api/session-jobs").expect(200);
});

it("closes storage and exits cleanly when terminated during restoration", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type",
      "module",
      "--eval",
      `import { createStartupServer } from ${JSON.stringify(new URL("./startupServer.ts", import.meta.url).href)};
    const { server } = createStartupServer(() => console.log("storage.closed"));
    server.listen(0, "127.0.0.1", async () => {
      const health = await fetch("http://127.0.0.1:" + server.address().port + "/health");
      if ((await health.json()).ready !== false) process.exit(1);
      process.emit("SIGTERM");
    });`,
    ],
    { timeout: 10_000 },
  );
  expect(stdout).toContain("storage.closed");
});
