export type PreviewKind =
  | "image"
  | "video"
  | "audio"
  | "text"
  | "binary"
  | "directory";

export type FileNodeLike = {
  type?: "file" | "directory";
  extension?: string | null;
};
