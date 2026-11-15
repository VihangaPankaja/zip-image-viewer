export function zipTimestamp(central: Buffer, offset: number): Date {
  const time = central.readUInt16LE(offset + 12);
  const date = central.readUInt16LE(offset + 14);
  const fallback = new Date(
    (date >> 9) + 1980,
    ((date >> 5) & 15) - 1,
    date & 31,
    time >> 11,
    (time >> 5) & 63,
    (time & 31) * 2,
  );
  let position = offset + 46 + central.readUInt16LE(offset + 28);
  const end = position + central.readUInt16LE(offset + 30);
  while (position + 4 <= end) {
    const type = central.readUInt16LE(position);
    const size = central.readUInt16LE(position + 2);
    const start = position + 4;
    if (start + size > end) break;
    if (type === 0x5455 && size >= 5 && central[start] & 1)
      return new Date(central.readUInt32LE(start + 1) * 1000);
    if (type === 0x000a && size >= 32) {
      let tag = start + 4;
      while (tag + 4 <= start + size) {
        const length = central.readUInt16LE(tag + 2);
        if (tag + 4 + length > start + size) break;
        if (central.readUInt16LE(tag) === 1 && length >= 24) {
          const stamp = new Date(
            Number(central.readBigUInt64LE(tag + 4) / 10_000n - 11_644_473_600_000n),
          );
          if (Number.isFinite(stamp.getTime())) return stamp;
        }
        tag += 4 + length;
      }
    }
    position = start + size;
  }
  return fallback;
}
