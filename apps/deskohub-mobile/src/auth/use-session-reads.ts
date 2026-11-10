import { useSyncExternalStore } from "react";
import { authClient } from "./auth-client";
import { countSessionReads } from "./session-reads";

const sessionStore = authClient.$store.atoms.session;
if (sessionStore === undefined) {
  throw new Error("The Better Auth client has no session store.");
}
const sessionReads = countSessionReads(sessionStore);

/** How many session reads have completed since launch. */
export const currentSessionReads = sessionReads.current;

/** {@link currentSessionReads}, re-rendering when a read completes. */
export const useSessionReads = (): number =>
  useSyncExternalStore(sessionReads.subscribe, sessionReads.current);
