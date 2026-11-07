import { Exit, Option } from "effect";
import { useCallback } from "react";
import type { AuthUser } from "./auth-session-state";
import { nativeAuthRuntime } from "./native-auth-runtime";
import { reauthenticate } from "./native-sign-in";
import {
  type NativeSignInFailure,
  SignInUnavailable,
} from "./native-sign-in-errors";
import { type AuthTaskState, useAuthTask } from "./use-auth-task";

export { isReauthenticationRequired } from "./auth-session-state";

/**
 * How a reauthentication ended: confirmed (retry the action), failed (the
 * state carries the failure to show), already running, or, on web, sent to
 * the sign-in page, which returns to the current route.
 */
export type ReauthenticationOutcome =
  | "reauthenticated"
  | "failed"
  | "busy"
  | "redirected";

export interface Reauthentication {
  readonly state: AuthTaskState<AuthUser, NativeSignInFailure>;
  readonly reauthenticate: () => Promise<ReauthenticationOutcome>;
}

const runReauthentication = () => reauthenticate;
const unexpected = () => new SignInUnavailable({});

/**
 * The prompt for sensitive actions the server refused with
 * `SESSION_NOT_FRESH` or `SESSION_EXPIRED` (see `isReauthenticationRequired`):
 * call `reauthenticate()` and retry the action on `"reauthenticated"`. Native
 * runs a new email sign-in in the auth session and refuses an account switch.
 * Show `state` with `nativeSignInFailureMessage` in a mounted live region.
 */
export const useReauthentication = (): Reauthentication => {
  const { state, start } = useAuthTask(
    nativeAuthRuntime,
    runReauthentication,
    unexpected
  );
  const run = useCallback(
    async (): Promise<ReauthenticationOutcome> =>
      Option.match(await start(), {
        onNone: () => "busy",
        onSome: (exit) => (Exit.isSuccess(exit) ? "reauthenticated" : "failed"),
      }),
    [start]
  );
  return { state, reauthenticate: run };
};
