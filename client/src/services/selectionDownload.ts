import {
  selectionExportPlanSchema,
  selectionExportInputSchema,
  selectionExportErrorSchema,
} from "../../../shared/contracts";
import { fetchJson } from "./apiClient";

export async function planSelectionDownload(
  sessionId: string,
  paths: string[],
  signal: AbortSignal,
) {
  return selectionExportPlanSchema.parse(
    await fetchJson<unknown>(`/api/sessions/${encodeURIComponent(sessionId)}/export/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(selectionExportInputSchema.parse({ paths })),
      signal,
    }),
  );
}

// A native attachment streams to the browser's download manager, never to a Blob in JS memory.
export function startSelectionDownload(
  sessionId: string,
  paths: string[],
  confirmed: boolean,
  onError: (_message: string) => void,
) {
  const frame = document.createElement("iframe");
  frame.name = `selection-download-${crypto.randomUUID()}`;
  frame.title = "Selection download response";
  frame.hidden = true;
  frame.addEventListener("load", () => {
    try {
      const text = frame.contentDocument?.body.textContent;
      if (!text) return;
      const parsed = selectionExportErrorSchema.safeParse(JSON.parse(text));
      onError(parsed.success ? parsed.data.error : "Export failed. Select the files again.");
    } catch {
      onError("Export failed. Select the files again.");
    }
  });
  document.body.append(frame);
  const form = document.createElement("form");
  form.method = "post";
  form.action = `/api/sessions/${encodeURIComponent(sessionId)}/export`;
  form.target = frame.name;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "selection";
  input.value = JSON.stringify(selectionExportInputSchema.parse({ paths, confirmed }));
  form.append(input);
  document.body.append(form);
  try {
    form.submit();
  } finally {
    form.remove();
  }
  return () => frame.remove();
}
