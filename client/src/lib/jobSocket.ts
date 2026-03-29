export type JobSocketPacket = {
  type?: string;
  job?: unknown;
  error?: string;
};

export type JobSocketHandlers = {
  onJob: (payload: unknown) => void;
  onMalformedPayload: () => void;
  onSocketError: () => void;
  onSocketClose: () => void;
};

function getJobSocketUrl(jobId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/jobs?jobId=${encodeURIComponent(jobId)}`;
}

export function openJobSocket(jobId: string, handlers: JobSocketHandlers): WebSocket {
  const socket = new WebSocket(getJobSocketUrl(jobId));

  socket.addEventListener("message", (event) => {
    try {
      const packet = JSON.parse(event.data) as JobSocketPacket;
      if (packet?.job == null) {
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
