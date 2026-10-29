import { crc32 } from "node:zlib";

export function zipBytes(entries: { name: string; size?: number; mode?: number; data?: Buffer }[]) {
  const locals: Buffer[] = [];
  const headers: Buffer[] = [];
  let offset = 0;
  for (const { name, data = Buffer.alloc(0), size = data.length, mode = 0 } of entries) {
    const filename = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(filename.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(3 << 8, 4);
    header.writeUInt16LE(0x800, 8);
    header.writeUInt32LE(crc32(data), 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(filename.length, 28);
    header.writeUInt32LE((mode << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    locals.push(local, filename, data);
    headers.push(header, filename);
    offset += local.length + filename.length + data.length;
  }
  const central = Buffer.concat(headers);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
