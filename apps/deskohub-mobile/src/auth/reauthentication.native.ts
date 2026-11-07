import { Effect, Exit, Option } from "effect";
import { useCallback } from "react";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import type { AuthUser } from "./auth-session-state";
import { nativeAuthRuntime } from "./native-auth-runtime";
import { reauthenticate } from "./native-sign-in";
import {
  type NativeSignInFailure,
  SignInUnavailable,
} from "./native-sign-in-errors";
import { SignInLocale } from "./sign-in-locale";
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

const runReauthentication = (locale: AppLocale) =>
  reauthenticate.pipe(Effect.provideService(SignInLocale, locale));
const unexpected = () => new SignInUnavailable({});

/**
 * The prompt for sensitive actions the server refused with
 * `SESSION_NOT_FRESH` or `SESSION_EXPIRED` (see `isReauthenticationRequired`):
 * call `reauthenticate()` and retry the action on `"reauthenticated"`. Native
 * runs a new email sign-in in the auth session and refuses an account switch.
 * Show `state` with `nativeSignInFailureMessage` in a mounted live region.
 */
export const useReauthentication = (): Reauthentication => {
  const locale = useAppLocale();
  const { state, start } = useAuthTask(
    nativeAuthRuntime,
    runReauthentication,
    unexpected
  );
  const run = useCallback(
    async (): Promise<ReauthenticationOutcome> =>
      Option.match(await start(locale), {
        onNone: () => "busy",
        onSome: (exit) => (Exit.isSuccess(exit) ? "reauthenticated" : "failed"),
      }),
    [start, locale]
  );
  return { state, reauthenticate: run };
};
