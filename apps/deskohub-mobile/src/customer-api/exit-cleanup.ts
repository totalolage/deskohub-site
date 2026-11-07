import { Effect, Match, Option } from "effect";
import type { AuthSessionState } from "../auth/auth-session-state";
import {
  AccountExitFence,
  type AccountSession,
  isAccountStorageKey,
  isExitClearedKey,
} from "./account-scoped-storage";
import { DeviceStorage, TemporaryFiles } from "./device-capabilities";

/**
 * What an exit cleans up: one session's account data, or (on a launch that
 * finds no session) whatever earlier accounts left.
 */
export type AccountExit =
  | ({ readonly scope: "account" } & AccountSession)
  | { readonly scope: "device" };

/**
 * Removes what an exiting account left on the device: its storage entries
 * and the temporary files it shared. It runs alone through the fence: an
 * account write in flight lands first, the exited session can't write
 * afterwards, and nothing is removed for an account that has signed in again
 * meanwhile or (device scope) that has a session open. A storage failure
 * leaves the keys for a later exit or launch; their names carry the account,
 * so no other account reads them.
 */
export const customerDataExitCleanup = (exit: AccountExit) =>
  Match.value(exit).pipe(
    Match.discriminatorsExhaustive("scope")({
      account: accountExitCleanup,
      device: () => deviceExitCleanup,
    }),
    (cleanup) =>
      Effect.flatMap(Effect.service(AccountExitFence), (fence) =>
        fence.exclusive(cleanup)
      ),
    Effect.uninterruptible,
    Effect.withSpan("CustomerData.exitCleanup")
  );

// Removes the account's data unless a later session of it has opened.
const accountExitCleanup = (session: AccountSession) =>
  removeAccountData(session).pipe(
    Effect.when(closeForExit(session)),
    Effect.asVoid
  );

const closeForExit = (session: AccountSession) =>
  Effect.flatMap(Effect.service(AccountExitFence), (fence) =>
    fence.close(session)
  );

const removeAccountData = ({ accountId }: AccountSession) =>
  removeStorageKeys((key) => isAccountStorageKey(key, accountId)).pipe(
    Effect.andThen(sweepTemporaryFiles(Option.some(accountId)))
  );

// Removes what earlier accounts left, keeping what an open session owns.
// Temporary files carry no session, so they go only when none is open.
const deviceExitCleanup = Effect.Do.pipe(
  Effect.bind("open", () => openAccounts),
  Effect.tap(({ open }) => removeStorageKeys(isUnownedKey(open))),
  Effect.tap(({ open }) =>
    sweepTemporaryFiles(Option.none()).pipe(
      Effect.when(Effect.succeed(open.size === 0))
    )
  ),
  Effect.asVoid
);

const openAccounts = Effect.flatMap(
  Effect.service(AccountExitFence),
  (fence) => fence.openAccounts
);

const isUnownedKey = (open: ReadonlySet<string>) => {
  const owners = [...open];
  return (key: string) =>
    isExitClearedKey(key) &&
    !owners.some((accountId) => isAccountStorageKey(key, accountId));
};

// A storage failure leaves the keys for a later exit or launch.
const removeStorageKeys = (remove: (key: string) => boolean) =>
  Effect.Do.pipe(
    Effect.bind("storage", () => Effect.service(DeviceStorage)),
    Effect.bind("keys", ({ storage }) => storage.keys),
    Effect.tap(({ storage, keys }) => storage.removeItems(keys.filter(remove))),
    Effect.ignore
  );

const sweepTemporaryFiles = (owner: Option.Option<string>) =>
  Effect.flatMap(Effect.service(TemporaryFiles), (files) => files.sweep(owner));

/** Who the app is signed in as, as far as exit cleanup cares. */
export type AccountPresence =
  | { readonly status: "restoring" }
  | { readonly status: "signed-out" }
  | ({ readonly status: "signed-in" } & AccountSession);

export const accountPresenceOf = (
  session: AuthSessionState
): AccountPresence =>
  session.status === "signed-in"
    ? {
        status: "signed-in",
        accountId: session.user.id,
        sessionStartedAt: session.signedInAt.getTime(),
      }
    : session;

/**
 * The exit that moving from `previous` to `next` means: the previous account
 * signed out or was replaced by another. Signing in again as the same account
 * (reauthentication) is no exit. A launch that finds no session cleans the
 * device, in case the last exit's cleanup didn't finish or the session
 * expired while the app was closed.
 */
export const accountExitOf = (
  previous: AccountPresence,
  next: AccountPresence
): AccountExit | undefined => {
  if (next.status === "restoring") return undefined;
  if (previous.status === "signed-in") {
    return next.status === "signed-out" || previous.accountId !== next.accountId
      ? {
          scope: "account",
          accountId: previous.accountId,
          sessionStartedAt: previous.sessionStartedAt,
        }
      : undefined;
  }
  return previous.status === "restoring" && next.status === "signed-out"
    ? { scope: "device" }
    : undefined;
};
