import { Effect } from "effect";
import type { AuthSessionState } from "../auth/auth-session-state";
import { DeviceStorage, TemporaryFiles } from "./device-capabilities";

/**
 * Storage the app keeps per signed-in account. Every key with one of these
 * prefixes goes when the account exits (sign-out, expiry or account switch).
 * The reservations offline cache and the booking flow's remembered referral
 * code live here.
 */
export const exitClearedStoragePrefixes = [
  "deskohub.reservations.v1.",
  "deskohub.booking.",
] as const;

export const isExitClearedKey = (key: string) =>
  exitClearedStoragePrefixes.some((prefix) => key.startsWith(prefix));

/**
 * Removes what an account left on the device: its cached data and the
 * temporary files it shared. A storage failure leaves the keys for the next
 * exit or launch; their names carry the account, so no other account reads
 * them meanwhile.
 */
export const customerDataExitCleanup = Effect.gen(function* () {
  const storage = yield* DeviceStorage;
  const temporaryFiles = yield* TemporaryFiles;
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
