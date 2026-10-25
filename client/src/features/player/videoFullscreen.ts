export async function toggleVideoFullscreen(
  shell: HTMLDivElement | null,
  video: HTMLVideoElement | null,
) {
  if (document.fullscreenElement) return document.exitFullscreen();
  if (shell?.requestFullscreen) return shell.requestFullscreen();
  const nativeVideo: (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null = video;
  if (!nativeVideo?.webkitEnterFullscreen) throw new Error("Fullscreen is unavailable.");
  const controls = nativeVideo.controls;
  const restore = () => {
    nativeVideo.controls = controls;
  };
  nativeVideo.addEventListener("webkitendfullscreen", restore, { once: true });
  nativeVideo.controls = true;
  try {
    nativeVideo.webkitEnterFullscreen();
  } catch (error) {
    nativeVideo.removeEventListener("webkitendfullscreen", restore);
    restore();
    throw error;
  }
}
