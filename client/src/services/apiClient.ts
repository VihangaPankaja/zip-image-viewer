export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const response = await fetch(input, init);
  const payload: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error =
      typeof payload === "object" && payload !== null && "error" in payload
        ? payload.error
        : undefined;
    const message =
      typeof error === "string" && error
        ? error
        : `Request failed (${String(response.status)})`;
    throw new Error(message);
  }

  return payload as T;
}
