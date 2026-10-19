import type { Session } from "../../domain/models.js";
import { ApplicationError } from "../../domain/models.js";
import type { SessionStorage } from "../../../shared/contracts.js";

export function createSessionStorage(
  touchSession: (_id: string) => Session | undefined,
  media: {
    storage: (_session: Session) => Promise<Omit<SessionStorage, "retained" | "pinned">>;
    clearMediaCache: (_session: Session) => Promise<void>;
  },
) {
  function session(id: string) {
    const item = touchSession(id);
    if (!item) throw new ApplicationError("NOT_FOUND", "Session not found.", 404);
    return item;
  }
  return {
    get: async (id: string) => {
      const item = session(id);
      return {
        ...(await media.storage(item)),
        retained: !!item.retained,
        pinned: !!item.pinned,
      };
    },
    clear: (id: string) => media.clearMediaCache(session(id)),
    pin: (id: string, pinned: boolean) => {
      session(id).pinned = pinned;
    },
  };
}
