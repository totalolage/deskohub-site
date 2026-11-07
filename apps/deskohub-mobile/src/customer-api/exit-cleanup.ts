import { Effect, Option } from "effect";
import type { AuthSessionState } from "../auth/auth-session-state";
import {
  AccountExitFence,
  isAccountStorageKey,
  isExitClearedKey,
} from "./account-scoped-storage";
import { DeviceStorage, TemporaryFiles } from "./device-capabilities";

/**
 * What an exit cleans up: one account's data, or (on a launch that finds no
 * session) whatever any earlier account left.
 */
export type AccountExit =
  | { readonly scope: "account"; readonly accountId: string }
  | { readonly scope: "device" };

/**
 * Removes what an exiting account left on the device: its storage entries
 * and the temporary files it shared. Its fence advances first, so a write
 * still in flight undoes itself; another account signed in meanwhile keeps
 * its own data. A storage failure leaves the keys for a later exit or launch;
 * their names carry the account, so no other account reads them.
 */
export const customerDataExitCleanup = (exit: AccountExit) =>
  Effect.gen(function* () {
    const storage = yield* DeviceStorage;
    const temporaryFiles = yield* TemporaryFiles;
    const owner =
      exit.scope === "account" ? Option.some(exit.accountId) : Option.none();
    if (exit.scope === "account") {
      yield* (yield* AccountExitFence).advance(exit.accountId);
    }
    yield* storage.keys.pipe(
      Effect.flatMap((keys) =>
        storage.removeItems(
          keys.filter((key) =>
            Option.match(owner, {
              onNone: () => isExitClearedKey(key),
              onSome: (accountId) => isAccountStorageKey(key, accountId),
            })
          )
        )
      ),
      Effect.ignore
    );
    yield* temporaryFiles.sweep(owner);
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
 * The exit that moving from `previous` to `next` means: the previous account
 * signed out or was replaced by another. A launch that finds no session
 * cleans the device, in case the last exit's cleanup didn't finish or the
 * session expired while the app was closed.
 */
export const accountExitOf = (
  previous: AccountPresence,
  next: AccountPresence
): AccountExit | undefined => {
  if (next.status === "restoring") return undefined;
  if (previous.status === "signed-in") {
    return next.status === "signed-out" || previous.accountId !== next.accountId
      ? { scope: "account", accountId: previous.accountId }
      : undefined;
  }
  return previous.status === "restoring" && next.status === "signed-out"
    ? { scope: "device" }
    : undefined;
};
