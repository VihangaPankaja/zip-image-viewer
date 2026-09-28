import { normalizeSubtitles } from "./subtitles";

describe("external subtitle validation", () => {
  it("converts BOM and CRLF SRT timestamps without treating caption text as HTML", () => {
    expect(
      normalizeSubtitles(
        "\uFEFF1\r\n00:00:01,250 --> 00:00:03,000\r\n<b>Hello</b>\r\n<script>alert(1)</script>",
        "srt",
      ),
    ).toBe(
      "WEBVTT\n\n00:00:01.250 --> 00:00:03.000\n<b>Hello</b>\n<script>alert(1)</script>\n",
    );
  });
  it("preserves native VTT cue positioning and comments", () => {
    const vtt =
      "WEBVTT\n\nNOTE example\nignored\n\nintro\n00:01.000 --> 00:03.000 align:start position:10%\nHello\n";
    expect(normalizeSubtitles(vtt, "vtt")).toBe(vtt);
  });
  it.each([
    ["not captions", "vtt"],
    ["WEBVTT\n\n00:01.000 --> 00:00.000\nBackwards", "vtt"],
    ["WEBVTT\n\n00:61.000 --> 01:03.000\nInvalid", "vtt"],
    ["WEBVTT\n\n00:01.000 --> 00:03.000\n", "vtt"],
    ["WEBVTT\n\n00:01.000 --> 00:03.000\nGood\n\nbroken cue", "vtt"],
    ["1\n00:00:01,000 --> 00:00:03,000", "srt"],
  ])("rejects malformed or empty input", (text, extension) => {
    expect(() => normalizeSubtitles(text, extension)).toThrow();
  });
  it("rejects excessive cue counts", () => {
    expect(() =>
      normalizeSubtitles(
        "WEBVTT\n\n" + "00:01.000 --> 00:03.000\nHello\n\n".repeat(10001),
        "vtt",
      ),
    ).toThrow(/10,000/);
  });
});
