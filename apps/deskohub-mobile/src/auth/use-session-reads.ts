import { useSyncExternalStore } from "react";
import { authClient } from "./auth-client";
import { countSessionReads } from "./session-reads";

const sessionReads = countSessionReads(authClient.$store.atoms.session);

/** How many session reads have completed since launch. */
export const currentSessionReads = sessionReads.current;

/** {@link currentSessionReads}, re-rendering when a read completes. */
export const useSessionReads = (): number =>
  useSyncExternalStore(sessionReads.subscribe, sessionReads.current);
