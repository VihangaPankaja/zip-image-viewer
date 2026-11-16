export function archiveVolume(filename: string) {
  const match =
    /^(.*\.7z\.)(\d{3,6})$/i.exec(filename) ?? /^(.*\.part)(\d{1,6})(\.rar)$/i.exec(filename);
  if (!match) return undefined;
  const number = Number(match[2]);
  if (number < 1 || number > 10_000) return undefined;
  const prefix = match[1];
  const suffix = filename.toLowerCase().endsWith(".rar") ? match[3] : "";
  const width = match[2].startsWith("0")
    ? match[2].length
    : Math.min(match[2].length, suffix ? 2 : 3);
  const name = (part: number) => `${prefix}${String(part).padStart(width, "0")}${suffix}`;
  return { key: `${prefix}#${suffix}`, number, first: name(1), name };
}

export function groupArchiveVolumes<T>(
  items: readonly T[],
  filename: (_item: T) => string = String,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const [position, item] of items.entries()) {
    const volume = archiveVolume(filename(item));
    const key = volume?.key ?? `single:${position}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => {
    group.sort(
      (a, b) =>
        (archiveVolume(filename(a))?.number ?? 0) - (archiveVolume(filename(b))?.number ?? 0),
    );
    const compatible: T[][] = [];
    for (const item of group) {
      const part = archiveVolume(filename(item));
      const set = compatible.find(
        (items) => part && archiveVolume(filename(items[0]))?.name(part.number) === filename(item),
      );
      if (set) set.push(item);
      else compatible.push([item]);
    }
    return compatible;
  });
}

export function isArchiveName(filename: string): boolean {
  return (
    /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i.test(filename) || archiveVolume(filename) !== undefined
  );
}
