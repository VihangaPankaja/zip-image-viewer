import {
  jobSchema,
  localImportInputSchema,
  type LocalImportInput,
} from "../../../shared/contracts";

export async function initializeLocalImport(input: LocalImportInput, signal: AbortSignal) {
  const response = await fetch("/api/local-imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(localImportInputSchema.parse(input)),
    signal,
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(importError(data));
  return jobSchema.parse(data);
}

function importError(value: unknown) {
  if (typeof value === "object" && value && "error" in value && typeof value.error === "string")
    return value.error;
  return "Could not upload this file. Retry when the connection is available.";
}

export function uploadLocalFile(
  id: string,
  file: File,
  signal: AbortSignal,
  progress: (_sent: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    request.upload.addEventListener("progress", (event) =>
      progress(Math.min(file.size, event.loaded)),
    );
    request.open("PUT", `/api/local-imports/${encodeURIComponent(id)}/content`);
    request.setRequestHeader("content-type", "application/octet-stream");
    request.timeout = 15 * 60_000;
    request.onload = () => {
      try {
        const data: unknown = JSON.parse(request.responseText);
        if (request.status < 200 || request.status >= 300) throw new Error(importError(data));
        jobSchema.parse(data);
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Invalid upload response."));
      }
    };
    request.onerror = () => finish(new Error("Upload interrupted. Retry this file."));
    request.ontimeout = () => finish(new Error("Upload timed out. Retry this file."));
    request.onabort = () => finish(new DOMException("Upload cancelled.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      finish(new DOMException("Upload cancelled.", "AbortError"));
      return;
    }
    // File is a disk-backed Blob. Do not read it into an ArrayBuffer or a data URL.
    request.send(file);
  });
}
