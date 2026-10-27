import { open } from "node:fs/promises";
import { TEXT_PREVIEW_BYTES, type TextPreviewChunk } from "../../../shared/contracts.js";

function detectEncoding(prefix: Buffer): TextPreviewChunk["encoding"] {
  if (prefix[0] === 0xff && prefix[1] === 0xfe) return "utf-16le";
  if (prefix[0] === 0xfe && prefix[1] === 0xff) return "utf-16be";
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i + 1 < prefix.length; i += 2) {
    if (prefix[i] === 0) evenZeros++;
    if (prefix[i + 1] === 0) oddZeros++;
  }
  const pairs = Math.floor(prefix.length / 2);
  if (pairs >= 4 && oddZeros / pairs > 0.6 && evenZeros === 0) return "utf-16le";
  if (pairs >= 4 && evenZeros / pairs > 0.6 && oddZeros === 0) return "utf-16be";
  return "utf-8";
}

function splitUtf8Prefix(previous: Buffer, bytes: Buffer): number {
  for (let i = 0; i < previous.length; i++) {
    const lead = previous[i];
    const length =
      lead >= 0xc2 && lead <= 0xdf
        ? 2
        : lead >= 0xe0 && lead <= 0xef
          ? 3
          : lead >= 0xf0 && lead <= 0xf4
            ? 4
            : 0;
    const missing = length - (previous.length - i);
    if (missing <= 0) continue;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat([previous.subarray(i), bytes.subarray(0, missing)]),
      );
      return missing;
    } catch {
      /* Malformed bytes must remain visible as replacement characters. */
    }
  }
  return 0;
}

function characterRange(
  bytes: Buffer,
  offset: number,
  end: number,
  size: number,
  encoding: TextPreviewChunk["encoding"],
  previous: Buffer,
): [number, number] {
  let start = 0;
  if (encoding === "utf-8") {
    start = splitUtf8Prefix(previous, bytes);
    if (offset + end < size) {
      const boundary = end;
      while (end > start && boundary - end < 3 && (bytes[end] & 0xc0) === 0x80) end--;
      if ((bytes[end] & 0xc0) === 0x80) end = boundary;
    }
  } else {
    const previousUnit =
      previous.length < 2
        ? 0
        : encoding === "utf-16le"
          ? previous.readUInt16LE(0)
          : previous.readUInt16BE(0);
    const unit = (i: number) =>
      encoding === "utf-16le" ? bytes.readUInt16LE(i) : bytes.readUInt16BE(i);
    if (
      previousUnit >= 0xd800 &&
      previousUnit <= 0xdbff &&
      bytes.length >= 2 &&
      unit(0) >= 0xdc00 &&
      unit(0) <= 0xdfff
    )
      start = 2;
    if (offset + end < size) {
      end -= end % 2;
      if (end >= 2 && unit(end - 2) >= 0xd800 && unit(end - 2) <= 0xdbff) end -= 2;
    }
  }
  return [start, end];
}

export async function readTextPreview(
  targetPath: string,
  requestedOffset: number,
  signal: AbortSignal,
): Promise<TextPreviewChunk> {
  signal.throwIfAborted();
  const file = await open(targetPath, "r");
  try {
    const { size } = await file.stat();
    const prefix = Buffer.alloc(Math.min(512, size));
    await file.read(prefix, 0, prefix.length, 0);
    const encoding = detectEncoding(prefix);
    let offset = Math.min(requestedOffset, size);
    if (encoding !== "utf-8" && offset < size) offset -= offset % 2;
    const bytes = Buffer.alloc(Math.min(TEXT_PREVIEW_BYTES + 4, size - offset));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
    const previous = Buffer.alloc(Math.min(encoding === "utf-8" ? 3 : 2, offset));
    await file.read(previous, 0, previous.length, offset - previous.length);
    signal.throwIfAborted();
    const [start, end] = characterRange(
      bytes.subarray(0, bytesRead),
      offset,
      Math.min(TEXT_PREVIEW_BYTES, bytesRead),
      size,
      encoding,
      previous,
    );
    const text = new TextDecoder(encoding, { ignoreBOM: offset !== 0 }).decode(
      bytes.subarray(start, end),
    );
    let controls = 0;
    for (const char of text)
      if (char < " " && char !== "\n" && char !== "\r" && char !== "\t") controls++;
    return {
      text,
      offset: offset + start,
      nextOffset: offset + end,
      totalBytes: size,
      encoding,
      binary: text.includes("\0") || controls > Math.max(2, text.length / 100),
      replacementCharacters: text.includes("\ufffd"),
    };
  } finally {
    await file.close();
  }
}
