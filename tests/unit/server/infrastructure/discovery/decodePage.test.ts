import { expect, it } from "vite-plus/test";
import { decodePage } from "../../../../../server/infrastructure/discovery/decodePage.js";

it.each([
  '<META CHARSET="windows-1252">',
  '<meta content="text/html; charset=iso-8859-1" http-equiv="CONTENT-TYPE">',
  '<meta charset="made-up"><meta charset="windows-1252">',
  '<meta charset="x-user-defined">',
])("uses supported HTML encoding declaration %#", (declaration) => {
  expect(
    decodePage(Buffer.from(`${declaration}<a href="/café.zip">Café</a>`, "latin1"), "text/html"),
  ).toContain('<a href="/café.zip">Café</a>');
});

it.each([
  '<!-- <meta charset="windows-1252"> -->',
  '<script>"<meta charset=windows-1252>"</script>',
  "<template><meta charset=windows-1252></template>",
  '<meta content="text/html; charset=windows-1252">',
  '<meta charset="made-up">',
  `${" ".repeat(1024)}<meta charset=windows-1252>`,
  '<meta charset="utf-16">',
])("ignores inert, invalid or out-of-window declaration %#", (declaration) => {
  expect(
    decodePage(Buffer.from(`${declaration}<a href="/café.zip">Café</a>`), "text/html"),
  ).toContain('<a href="/café.zip">Café</a>');
});

it("keeps BOM and transport precedence over conflicting metadata", () => {
  const markup = '<meta charset=windows-1252><a href="/café.zip">Café</a>';
  expect(decodePage(Buffer.from(markup), "text/html; charset=utf-8")).toBe(markup);
  expect(decodePage(Buffer.from(`\ufeff${markup}`), "text/html; charset=windows-1252")).toBe(
    markup,
  );
  const utf16 = Buffer.from(`\ufeff${markup}`, "utf16le");
  expect(decodePage(utf16, "text/html; charset=utf-8")).toBe(markup);
  expect(decodePage(Buffer.from(utf16).swap16(), "text/html; charset=utf-8")).toBe(markup);
  expect(() => decodePage(Buffer.from(markup), "text/html; charset=made-up")).toThrow(
    /unsupported text encoding/,
  );
});
