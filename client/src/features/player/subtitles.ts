export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

function timestamp(value: string) {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[.,](\d{3})$/.exec(value);
  if (!match) throw new Error("Invalid subtitle timestamp.");
  return (
    Number(match[1] || 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000
  );
}

export function normalizeSubtitles(text: string, extension: string): string {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const isSrt = extension === "srt";
  if (!isSrt && !/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(normalized)) {
    throw new Error("Choose a valid WebVTT or SRT subtitle file.");
  }
  const blocks = normalized.split(/\n[ \t]*\n/);
  if (!isSrt) blocks.shift();
  let cues = 0;
  const converted = blocks.map((block) => {
    if (
      !isSrt &&
      /^(NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)
    )
      return block;
    const lines = block.split("\n");
    const timingIndex = lines[0]?.includes("-->") ? 0 : 1;
    const timing = /^(\S+)[ \t]+-->[ \t]+(\S+)([^\n]*)$/.exec(
      lines[timingIndex] ?? "",
    );
    if (
      !timing ||
      !lines
        .slice(timingIndex + 1)
        .join("\n")
        .trim() ||
      timestamp(timing[1]) >= timestamp(timing[2])
    ) {
      throw new Error(
        "Malformed subtitles. Check cue timestamps and text, then try again.",
      );
    }
    cues += 1;
    if (cues > 10000)
      throw new Error("Subtitle files may contain at most 10,000 cues.");
    if (!isSrt) return block;
    // Text stays in a native text track, never in the document's HTML.
    return `${timing[1].replace(",", ".")} --> ${timing[2].replace(",", ".")}\n${lines.slice(timingIndex + 1).join("\n")}`;
  });
  if (!cues) throw new Error("No subtitle cues found. Choose another file.");
  return isSrt ? `WEBVTT\n\n${converted.join("\n\n")}\n` : `${normalized}\n`;
}
