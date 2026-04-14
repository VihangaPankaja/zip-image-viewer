import {
  jobStore,
  sessionStore,
  videoTranscodeStore,
} from "../repositories/memoryStores.js";
import {
  formatBytes,
  isTerminalJobStatus,
  logEvent,
  parseRangeHeader,
  sanitizeEntryPath,
} from "../infrastructure/runtime/runtimePrimitives.js";

export function createServerContainer() {
  return {
    stores: {
      jobs: jobStore,
      sessions: sessionStore,
      videoTranscodes: videoTranscodeStore,
    },
    metrics: {
      getSessionCount: () => sessionStore.size,
      getJobCount: () => jobStore.size,
    },
    runtime: {
      logEvent,
      formatBytes,
      parseRangeHeader,
      sanitizeEntryPath,
      isTerminalJobStatus,
    },
  };
}
