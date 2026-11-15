import { ApplicationError } from "../../domain/models.js";
import { inspectPage } from "../../infrastructure/discovery/inspectPage.js";

let activeInspections = 0;

export async function discoverPage(url: string, signal?: AbortSignal) {
  if (activeInspections >= 2)
    throw new ApplicationError(
      "CONFLICT",
      "Two pages are already being inspected. Try again shortly.",
      409,
    );
  activeInspections++;
  try {
    return await inspectPage(url, { signal });
  } catch {
    // Network errors may contain signed URLs or credentials from a hostile response.
    throw new ApplicationError(
      "INVALID_INPUT",
      "Could not inspect this public HTML page. Check the URL and access permissions. Pages must finish within 10 seconds and contain at most 2 MiB of HTML.",
      400,
    );
  } finally {
    activeInspections--;
  }
}
