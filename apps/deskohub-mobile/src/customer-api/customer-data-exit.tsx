import { useAtomSet } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { type ReactNode, useEffect, useRef } from "react";
import { useAuthSession } from "../auth/use-auth-session";
import { deviceCapabilitiesLayer } from "./device-capabilities-layer";
import {
  type AccountPresence,
  accountExited,
  customerDataExitCleanup,
} from "./exit-cleanup";

// Exit cleanup outlives the account's own registry, which unmounts with the
// signed-in screens, so it runs on the device capabilities alone.
const exitCleanupRuntime = Atom.runtime(deviceCapabilitiesLayer);
const exitCleanupAtom = exitCleanupRuntime.fn(() => customerDataExitCleanup);

/**
 * Mounted above the signed-in screens: when an account exits (sign-out,
 * expiry, switch) it clears that account's cached data and shared files. The
 * account's registry resets on its own, keyed by account id.
 */
export function CustomerDataExitCleanup({
  children,
}: {
  readonly children: ReactNode;
}) {
  const session = useAuthSession();
  const cleanUp = useAtomSet(exitCleanupAtom);
  const previous = useRef<AccountPresence>({ status: "restoring" });
  const status = session.status;
  const accountId = session.status === "signed-in" ? session.user.id : "";

  useEffect(() => {
    const next: AccountPresence =
      status === "signed-in" ? { status, accountId } : { status };
    if (accountExited(previous.current, next)) cleanUp();
    previous.current = next;
  }, [status, accountId, cleanUp]);

  return children;
}
