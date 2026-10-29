export function torrentSiblingFolder(paths: readonly string[]) {
  const roots = new Set(paths.map((entry) => entry.split("/")[0]?.toLowerCase()));
  let folder = "Torrent files";
  while (roots.has(folder.toLowerCase())) folder += "-";
  return folder;
}
