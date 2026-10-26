import { describe, expect, it } from "vite-plus/test";
import {
  buildTextRows,
  findTextRows,
  formatPreviewJson,
  parsePreviewTable,
} from "../../../../../client/src/features/workspace/textPreviewFormats";

describe("bounded text formats", () => {
  it("maps Unicode case-insensitive search to original character offsets", () => {
    const text = "İ".repeat(8) + "\nneedle\nWRONG";
    expect(findTextRows(text, buildTextRows(text, 4096), "NEEDLE")).toEqual([1]);
    expect(findTextRows("a.b\naXb", buildTextRows("a.b\naXb", 4096), "a.b")).toEqual([0]);
  });
  it("wraps tabs and wide characters within visible columns", () => {
    const tabs = buildTextRows("\t".repeat(100), 16, true);
    const wide = buildTextRows("界".repeat(100), 16, true);
    expect(tabs.every((row) => row.text.length <= 8)).toBe(true);
    expect(wide.every((row) => row.text.length <= 8)).toBe(true);
  });
  it("formats nested JSON without changing large numbers or string escapes", () => {
    const result = formatPreviewJson('{"id":9007199254740993,"nested":[{},"a\\\"b",true]}');
    expect(result.text).toBe(
      '{\n  "id": 9007199254740993,\n  "nested": [\n    {},\n    "a\\\"b",\n    true\n  ]\n}',
    );
  });
  it("keeps malformed, too large and too deeply nested JSON in raw form", () => {
    for (const input of [
      '{"x":',
      "[".repeat(65) + "0" + "]".repeat(65),
      JSON.stringify("x".repeat(65536)),
    ]) {
      expect(formatPreviewJson(input).text).toBe(input);
      expect(formatPreviewJson(input).message).not.toContain("Formatted JSON.");
    }
  });
  it("stops pretty-print expansion at its output limit", () => {
    const input =
      "[".repeat(60) + Array.from({ length: 2000 }, () => '"x"').join(",") + "]".repeat(60);
    expect(formatPreviewJson(input).text).toBe(input);
    expect(formatPreviewJson(input).message).toContain("exceeds");
  });
  it("caps table rows, columns and cell characters", () => {
    expect(parsePreviewTable("x\n".repeat(50000), ",", true).rows).toHaveLength(200);
    const wide = parsePreviewTable(Array.from({ length: 100 }, () => "x").join(","), ",", true);
    expect(wide.rows[0]).toHaveLength(32);
    expect(wide.limited).toBe(true);
    const long = parsePreviewTable('"' + "x".repeat(100000) + '"', ",", true);
    expect(long.rows[0][0]).toHaveLength(2048);
    expect(long.limited).toBe(true);
  });
  it("handles TSV, doubled quotes, embedded newlines and incomplete final records", () => {
    expect(parsePreviewTable('a\tb\n"c\td"\t"e""f"', "\t", true).rows).toEqual([
      ["a", "b"],
      ["c\td", 'e"f'],
    ]);
    expect(parsePreviewTable('a,b\n"not finished', ",", false)).toMatchObject({
      rows: [["a", "b"]],
      incomplete: true,
      invalid: false,
    });
    expect(parsePreviewTable('a,b\n"not finished', ",", true).invalid).toBe(true);
    expect(parsePreviewTable('a,b\n"c"bad,d', ",", true).invalid).toBe(true);
  });
  it("splits long lines without losing surrogate pairs or original line numbers", () => {
    const rows = buildTextRows("a".repeat(4095) + "😀b\r\nend", 4096);
    expect(rows.map((row) => row.text)).toEqual(["a".repeat(4095), "😀b", "end"]);
    expect(rows.map((row) => row.line)).toEqual([1, 1, 2]);
  });
});
