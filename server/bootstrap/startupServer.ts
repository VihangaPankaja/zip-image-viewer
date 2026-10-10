import { createServer, type RequestListener } from "node:http";

export function createStartupServer(closeStore: () => void) {
  let app: RequestListener | undefined;
  const server = createServer((req, res) => {
    if (app) {
      app(req, res);
      return;
    }
    const healthy =
      (req.method === "GET" || req.method === "HEAD") &&
      req.url?.split("?")[0] === "/health";
    res.statusCode = healthy ? 200 : 503;
    res.setHeader("Content-Type", "application/json");
    if (!healthy) res.setHeader("Retry-After", "1");
    res.end(
      JSON.stringify(
        healthy
          ? { ok: true, ready: false }
          : { error: "Restoring retained downloads. Try again soon." },
      ),
    );
  });
  // Startup only reads payloads or stages derived files; SQLite commits are synchronous.
  const stopStartup = () => {
    server.close(() => {
      closeStore();
      process.exit(0);
    });
    server.closeAllConnections();
  };
  process.once("SIGTERM", stopStartup);
  process.once("SIGINT", stopStartup);
  return {
    server,
    setApp: (readyApp: RequestListener) => {
      process.removeListener("SIGTERM", stopStartup);
      process.removeListener("SIGINT", stopStartup);
      app = readyApp;
    },
  };
}
