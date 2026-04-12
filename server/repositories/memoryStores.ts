export const sessionStore = new Map();
export const jobStore = new Map();
export const videoTranscodeStore = new Map();
export const pendingSessionJobs: Array<{
  job: unknown;
  confirmOversize: boolean;
}> = [];

let activeSessionJobCount = 0;

export function getActiveSessionJobCount() {
  return activeSessionJobCount;
}

export function incrementActiveSessionJobCount() {
  activeSessionJobCount += 1;
}

export function decrementActiveSessionJobCount() {
  activeSessionJobCount = Math.max(0, activeSessionJobCount - 1);
}
