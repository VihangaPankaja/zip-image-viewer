export function getImageNavigationTarget(
  key: string,
  images: readonly string[],
  currentIndex: number,
  nextPath: string,
  previousPath: string,
): string {
  if (currentIndex === -1) {
    return "";
  }
  if (key === "ArrowRight") {
    return nextPath;
  }
  if (key === "ArrowLeft") {
    return previousPath;
  }
  if (key === "Home") {
    return images[0] ?? "";
  }
  if (key === "End") {
    return images.at(-1) ?? "";
  }
  return "";
}
