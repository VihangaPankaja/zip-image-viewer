export type JobSocketPacket = {
  type?: string;
  job?: unknown;
  error?: string;
};

export type JobSocketHandlers = {
  onJob: (_payload: unknown) => void;
  onMalformedPayload: () => void;
  onSocketError: () => void;
  onSocketClose: () => void;
};

function getJobSocketUrl(jobId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/jobs?jobId=${encodeURIComponent(jobId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJobSocketPacket(value: string): JobSocketPacket {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Malformed job update");
  }
  if (!isRecord(parsed)) throw new Error("Malformed job update");
  return {
    type: typeof parsed.type === "string" ? parsed.type : undefined,
    job: parsed.job,
    error: typeof parsed.error === "string" ? parsed.error : undefined,
  };
}

export function openJobSocket(
  jobId: string,
  handlers: JobSocketHandlers,
): WebSocket {
  const socket = new WebSocket(getJobSocketUrl(jobId));

  socket.addEventListener("message", (event) => {
    try {
      if (typeof event.data !== "string")
        throw new Error("Malformed job update");
      const packet = parseJobSocketPacket(event.data);
      if (packet.job == null) {
        return;
      }
      handlers.onJob(packet.job);
    } catch {
      handlers.onMalformedPayload();
    }
  });

  socket.addEventListener("error", handlers.onSocketError);
  socket.addEventListener("close", handlers.onSocketClose);

  return socket;
}
