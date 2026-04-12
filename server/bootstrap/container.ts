import {
  jobStore,
  sessionStore,
  videoTranscodeStore,
} from "../repositories/memoryStores.js";

export function createServerContainer() {
  return {
    stores: {
      jobs: jobStore,
      sessions: sessionStore,
      videoTranscodes: videoTranscodeStore,
    },
  };
}
