import type {
  Session,
  SessionJob,
  VideoTranscodeEntry,
} from "../domain/models.js";

export const sessionStore = new Map<string, Session>();
export const jobStore = new Map<string, SessionJob>();
export const videoTranscodeStore = new Map<string, VideoTranscodeEntry>();
export const pendingSessionJobs: Array<{
  job: SessionJob;
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
