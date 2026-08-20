import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { SessionJob } from "../domain/models.js";

type JobSocketOptions = {
  jobStore: ReadonlyMap<string, SessionJob>;
  sanitizeJob: (_job: SessionJob) => unknown;
};

export function attachJobWebSocketServer(
  httpServer: Server,
  options: JobSocketOptions,
): WebSocketServer {
  const { jobStore, sanitizeJob } = options;

  const socketServer = new WebSocketServer({
    server: httpServer,
    path: "/ws/jobs",
  });

  socketServer.on("connection", (socket, req) => {
    const requestUrl = new URL(
      req.url || "/ws/jobs",
      `http://${req.headers.host || "localhost"}`,
    );
    const jobId = requestUrl.searchParams.get("jobId") || "";
    const job = jobStore.get(jobId);

    if (!job) {
      socket.send(JSON.stringify({ type: "error", error: "Job not found." }));
      socket.close(1008, "job-not-found");
      return;
    }

    job.socketSubscribers.add(socket);
    socket.send(JSON.stringify({ type: "snapshot", job: sanitizeJob(job) }));

    socket.on("close", () => {
      job.socketSubscribers.delete(socket);
    });
  });

  return socketServer;
}
