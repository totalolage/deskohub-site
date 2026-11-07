import { Effect } from "effect";
import type { AuthSessionState } from "../auth/auth-session-state";
import { AccountExitFence, isExitClearedKey } from "./account-scoped-storage";
import { DeviceStorage, TemporaryFiles } from "./device-capabilities";

/**
 * Removes what an account left on the device: its cached data and the
 * temporary files it shared. The fence advances first, so a write still in
 * flight undoes itself. A storage failure leaves the keys for the next exit
 * or launch; their names carry the account, so no other account reads them
 * meanwhile.
 */
export const customerDataExitCleanup = Effect.gen(function* () {
  const storage = yield* DeviceStorage;
  const temporaryFiles = yield* TemporaryFiles;
  yield* (yield* AccountExitFence).advance;
  yield* storage.keys.pipe(
    Effect.flatMap((keys) =>
      storage.removeItems(keys.filter(isExitClearedKey))
    ),
    Effect.ignore
  );
  yield* temporaryFiles.sweep;
}).pipe(Effect.withSpan("CustomerData.exitCleanup"));

/** Who the app is signed in as, as far as exit cleanup cares. */
export type AccountPresence =
  | { readonly status: "restoring" }
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly accountId: string };

export const accountPresenceOf = (
  session: AuthSessionState
): AccountPresence =>
  session.status === "signed-in"
    ? { status: "signed-in", accountId: session.user.id }
    : session;

/**
 * Whether moving from `previous` to `next` means an account exited: signed
 * out, or replaced by another. A launch that finds no session also cleans up,
 * in case the last exit's cleanup didn't finish or the session expired while
 * the app was closed.
 */
export const accountExited = (
  previous: AccountPresence,
  next: AccountPresence
): boolean => {
  if (next.status === "restoring") return false;
  if (next.status === "signed-out") return previous.status !== "signed-out";
  return (
    previous.status === "signed-in" && previous.accountId !== next.accountId
  );
};
