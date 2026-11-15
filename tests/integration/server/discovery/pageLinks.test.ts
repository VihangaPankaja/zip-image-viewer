import { describe, expect, it } from "vite-plus/test";
import { extractPageLinks } from "../../../../server/infrastructure/discovery/pageLinks.js";

describe("page link candidates", () => {
  it("resolves base/relative URLs, deduplicates fragments and preserves signed queries", () => {
    const result = extractPageLinks(
      `<!doctype html><base href="/files/"><base href="/ignored/">
      <a href="report.pdf#first">Report &amp; notes</a><a href="report.pdf#second">Duplicate</a>
      <a href="bundle.zip?token=a%2Fb">Bundle</a><a href="bundle.zip?token=b">Other token</a>
      <a href="get?id=42" download="photos.zip">Photos</a>
      <a href="stream?id=7" type="video/mp4">Movie</a><a href="../next">Next page</a>`,
      "https://example.com/redirected/index.html",
    );
    expect(result.truncated).toBe(false);
    expect(result.items.map(({ url }) => url)).toEqual([
      "https://example.com/files/report.pdf",
      "https://example.com/files/bundle.zip?token=a%2Fb",
      "https://example.com/files/bundle.zip?token=b",
      "https://example.com/files/get?id=42",
      "https://example.com/files/stream?id=7",
      "https://example.com/next",
    ]);
    expect(result.items[0]).toMatchObject({
      name: "Report & notes",
      kind: "file",
      type: "PDF",
      confidence: "high",
      sizeBytes: null,
    });
    expect(result.items[3]).toMatchObject({ name: "photos.zip", kind: "file", confidence: "high" });
    expect(result.items[4]).toMatchObject({ kind: "file", type: "video/mp4" });
    expect(result.items[5]).toMatchObject({ kind: "page", confidence: "low", sizeBytes: null });
    expect(
      result.items.every(
        ({ sourcePage }) => sourcePage === "https://example.com/redirected/index.html",
      ),
    ).toBe(true);
  });

  it("ignores unsafe URLs, script/template content and same-page anchors", () => {
    const html = `<base href="http://127.0.0.1/"><a href="/bad.zip">Bad base</a>
      <a href="javascript:alert(1)" download>Script</a><a href="file:///private.zip">Local</a>
      <a href="http://[::ffff:127.0.0.1]/a.zip">Mapped</a>
      <a href="https://user:secret@example.com/a.zip">Secret</a><a href="#section">Section</a>
      <script>"<a href='https://example.com/fake.zip'>"</script>
      <template><a href="https://example.com/template.zip">Hidden</a></template>
      <a href="https://cdn.example.com/real.zip">Real</a>`;
    expect(
      extractPageLinks(html, "https://example.com/index").items.map(({ name }) => name),
    ).toEqual(["Real"]);
  });

  it("bounds candidate output and handles malformed markup without executing it", () => {
    const result = extractPageLinks(
      Array.from({ length: 510 }, (_, i) => `<a href='/f${i}.zip'>File ${i}</a>`).join(""),
      "https://example.com/",
    );
    expect(result.items).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(
      extractPageLinks("<html><a href='/file.zip'><b>Unclosed", "https://example.com/").items[0]
        ?.name,
    ).toBe("Unclosed");
  });
});
