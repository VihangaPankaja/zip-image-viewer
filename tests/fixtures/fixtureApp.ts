import { once } from "node:events";
import type { Express } from "express";

export function registerFixtureSession(
  app: Express,
  session: {
    id: string;
    firstFilePath: string;
    fileCount: number;
  },
) {
  app.post("/rpc/sessions/list", (_req, res) =>
    res.json({
      json: { items: [{ ...session, lastAccessedAt: Date.now() }] },
    }),
  );
  app.post("/rpc/jobs/list", (_req, res) => res.json({ json: { items: [] } }));
}

export async function listenFixtureApp(app: Express, port: number) {
  const server = app.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
