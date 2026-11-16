import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { isWithinRoot } from "../runtime/filePaths.js";

export type ExportEntry = {
  path: string;
  source: string;
  directory: boolean;
  size: number;
  modifiedAt: number;
  dev: number;
  ino: number;
};

function extra(entry: ExportEntry, offset?: number) {
  const data = Buffer.alloc(offset === undefined ? 20 : 28);
  data.writeUInt16LE(1, 0);
  data.writeUInt16LE(data.length - 4, 2);
  data.writeBigUInt64LE(BigInt(entry.size), 4);
  data.writeBigUInt64LE(BigInt(entry.size), 12);
  if (offset !== undefined) data.writeBigUInt64LE(BigInt(offset), 20);
  return data;
}

function dosTime(milliseconds: number) {
  const date = new Date(
    Math.min(Date.UTC(2107, 11, 31), Math.max(Date.UTC(1980, 0, 1), milliseconds)),
  );
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function header(entry: ExportEntry, checksum: number, offset?: number) {
  const central = offset !== undefined;
  const name = Buffer.from(entry.path);
  const extended = extra(entry, offset);
  const data = Buffer.alloc(central ? 46 : 30);
  data.writeUInt32LE(central ? 0x02014b50 : 0x04034b50, 0);
  if (central) data.writeUInt16LE(45, 4);
  const base = central ? 6 : 4;
  data.writeUInt16LE(45, base);
  data.writeUInt16LE(0x0808, base + 2); // UTF-8 names and a streaming data descriptor.
  const stamp = dosTime(entry.modifiedAt);
  data.writeUInt16LE(stamp.time, base + 6);
  data.writeUInt16LE(stamp.date, base + 8);
  data.writeUInt32LE(checksum, base + 10);
  data.writeUInt32LE(0xffffffff, base + 14);
  data.writeUInt32LE(0xffffffff, base + 18);
  data.writeUInt16LE(name.length, base + 22);
  data.writeUInt16LE(extended.length, base + 24);
  if (central) {
    data.writeUInt32LE(entry.directory ? 0x10 : 0, 38);
    data.writeUInt32LE(0xffffffff, 42);
  }
  return Buffer.concat([data, name, extended]);
}

// The generator reads one 64 KiB chunk at a time, only when its downstream asks.
export async function* streamSelectionZip(
  entries: ExportEntry[],
  root: string,
  signal: AbortSignal,
) {
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    signal.throwIfAborted();
    let checksum = 0;
    let received = 0;
    const start = offset;
    const local = header(entry, 0);
    yield local;
    offset += local.length;
    if (!entry.directory) {
      if (!isWithinRoot(await realpath(entry.source), root))
        throw new Error("Export source changed ownership.");
      const file = await open(entry.source, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (
          !info.isFile() ||
          info.size !== entry.size ||
          info.mtimeMs !== entry.modifiedAt ||
          info.dev !== entry.dev ||
          info.ino !== entry.ino
        )
          throw new Error("Export source changed. Select the files again.");
        const input = file.createReadStream({ autoClose: false, highWaterMark: 64 * 1024, signal });
        try {
          for await (const chunk of input) {
            signal.throwIfAborted();
            const bytes = chunk as Buffer;
            received += bytes.length;
            if (received > entry.size) throw new Error("Export source grew during download.");
            checksum = crc32(bytes, checksum);
            yield bytes;
            offset += bytes.length;
          }
          if ((await file.stat()).mtimeMs !== entry.modifiedAt)
            throw new Error("Export source changed during download.");
        } finally {
          input.destroy();
        }
        if (received !== entry.size)
          throw new Error("Export source was truncated during download.");
      } finally {
        await file.close();
      }
    }
    const descriptor = Buffer.alloc(24);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeBigUInt64LE(BigInt(received), 8);
    descriptor.writeBigUInt64LE(BigInt(received), 16);
    yield descriptor;
    offset += descriptor.length;
    directory.push(header(entry, checksum, start));
  }
  signal.throwIfAborted();
  const directoryOffset = offset;
  for (const item of directory) {
    yield item;
    offset += item.length;
  }
  yield endRecords(entries.length, offset, directoryOffset);
}

function endRecords(count: number, offset: number, directoryOffset: number) {
  const end = Buffer.alloc(98);
  end.writeUInt32LE(0x06064b50, 0);
  end.writeBigUInt64LE(44n, 4);
  end.writeUInt16LE(45, 12);
  end.writeUInt16LE(45, 14);
  end.writeBigUInt64LE(BigInt(count), 24);
  end.writeBigUInt64LE(BigInt(count), 32);
  end.writeBigUInt64LE(BigInt(offset - directoryOffset), 40);
  end.writeBigUInt64LE(BigInt(directoryOffset), 48);
  end.writeUInt32LE(0x07064b50, 56);
  end.writeBigUInt64LE(BigInt(offset), 64);
  end.writeUInt32LE(1, 72);
  end.writeUInt32LE(0x06054b50, 76);
  // p7zip 16.02 rejects a needless ZIP64 entry-count sentinel on small exports.
  end.writeUInt16LE(Math.min(count, 0xffff), 84);
  end.writeUInt16LE(Math.min(count, 0xffff), 86);
  end.writeUInt32LE(Math.min(offset - directoryOffset, 0xffffffff), 88);
  end.writeUInt32LE(Math.min(directoryOffset, 0xffffffff), 92);
  return end;
}
