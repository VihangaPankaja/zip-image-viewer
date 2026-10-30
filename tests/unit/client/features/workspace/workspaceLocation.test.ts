import { expect, it } from "vite-plus/test";
import {
  readWorkspaceLocation,
  workspaceHash,
} from "../../../../../client/src/features/workspace/workspaceLocation";

const sessionId = "00000000-0000-4000-8000-000000000001";

it("round-trips selected files, filters and parent archive locations without losing Unicode", () => {
  const location = readWorkspaceLocation("");
  const selected = {
    ...location,
    view: "explore" as const,
    sessionId,
    path: "日本語/a #%.txt",
    search: "notes",
    media: "text" as const,
    parents: [
      {
        sessionId,
        path: "inner.7z",
        name: "outer.zip",
        search: "inner",
        media: "binary" as const,
        sort: "name-desc",
      },
    ],
  };
  expect(readWorkspaceLocation(workspaceHash(selected))).toEqual(selected);
});

it("rejects malformed, excessive and invalid route data and invalid sort modes", () => {
  for (const hash of [
    "#workspace=%",
    "#workspace=null",
    "#workspace=" + encodeURIComponent(JSON.stringify({ sessionId: "bad" })),
    "#workspace=" +
      encodeURIComponent(
        JSON.stringify({
          parents: Array(20).fill({ sessionId, path: "inner.zip", name: "outer" }),
        }),
      ),
  ]) {
    expect(readWorkspaceLocation(hash)).toMatchObject({ view: "downloads", path: "", parents: [] });
  }
  expect(
    readWorkspaceLocation("#workspace=" + encodeURIComponent(JSON.stringify({ sort: "invented" }))),
  ).toHaveProperty("sort", "natural-tail");
});
