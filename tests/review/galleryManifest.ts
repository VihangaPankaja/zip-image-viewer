export type GalleryManifest = {
  sourceCommit: string;
  fixtures: string;
  captures: {
    device: string;
    width: number;
    height: number;
    theme: string;
    screen: string;
    file: string;
  }[];
  encoderVerification: unknown[];
};

export function mergeGalleryManifests(fragments: GalleryManifest[]): GalleryManifest {
  const first = fragments.at(0);
  if (!first || !fragments.some(({ captures }) => captures.length))
    throw new Error("No gallery captures were produced.");
  if (fragments.some(({ sourceCommit }) => sourceCommit !== first.sourceCommit))
    throw new Error("Gallery workers captured different commits.");
  const captures = fragments.flatMap((fragment) => fragment.captures);
  if (new Set(captures.map(({ file }) => file)).size !== captures.length)
    throw new Error("Duplicate gallery capture. Run the full gallery again.");
  return {
    sourceCommit: first.sourceCommit,
    fixtures: first.fixtures,
    captures: captures.sort((a, b) => a.file.localeCompare(b.file)),
    encoderVerification: fragments.flatMap((fragment) => fragment.encoderVerification),
  };
}
