import { Match } from "effect";
import type { AppLocale } from "../i18n/app-locale";
import { m } from "../i18n/messages";
import type { AuthUser } from "./auth-session-state";
import type { NativeSignInFailure } from "./native-sign-in-errors";
import type { ReauthenticationOutcome } from "./reauthentication";
import { nativeSignInFailureMessage } from "./sign-in-failure-message";
import type { AuthTaskState } from "./use-auth-task";

/**
 * What a sensitive action shows about the reauthentication it asked for:
 * that it is under way, that it went through and the customer can repeat the
 * action, or why it failed.
 */
export type ReauthenticationNotice =
  | { readonly kind: "confirming" }
  | { readonly kind: "confirmed" }
  | { readonly kind: "failed"; readonly failure: NativeSignInFailure };

/**
 * The notice for a reauthentication's `state` and the `outcome` of the
 * caller's latest `reauthenticate()`, which the caller clears once the action
 * is repeated. A busy or redirected outcome adds nothing: the running
 * reauthentication, or the sign-in page, speaks for itself.
 */
export const reauthenticationNotice = (
  state: AuthTaskState<AuthUser, NativeSignInFailure>,
  outcome: ReauthenticationOutcome | undefined
): ReauthenticationNotice | undefined => {
  if (state.status === "running") return { kind: "confirming" };
  if (outcome === "reauthenticated") return { kind: "confirmed" };
  if (outcome === "failed" && state.status === "failed") {
    return { kind: "failed", failure: state.failure };
  }
  return undefined;
};

export const reauthenticationNoticeMessage = (
  notice: ReauthenticationNotice,
  locale: AppLocale
): string =>
  Match.value(notice).pipe(
    Match.discriminatorsExhaustive("kind")({
      confirming: () => m.reauthentication_in_progress({}, { locale }),
      confirmed: () => m.reauthentication_confirmed({}, { locale }),
      failed: ({ failure }) => nativeSignInFailureMessage(failure, locale),
    })
  );
