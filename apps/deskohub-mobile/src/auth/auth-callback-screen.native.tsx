import { Effect } from "effect";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Button, LiveMessage, Screen } from "../ui/controls";
import { LoadingIndicator } from "../ui/loading-indicator";
import { type AuthCallback, parseAuthCallbackParams } from "./auth-callback";
import { nativeAuthRuntime } from "./native-auth-runtime";
import { completeAuthCallback } from "./native-sign-in";
import { SignInUnavailable } from "./native-sign-in-errors";
import { nativeSignInFailureMessage } from "./sign-in-failure-message";
import { SignInLocale } from "./sign-in-locale";
import { useAuthSession } from "./use-auth-session";
import { useAuthTask } from "./use-auth-task";

const unexpected = () => new SignInUnavailable({});

/** Finishes the callback in the language the screen shows. */
const completeCallback = (callback: AuthCallback, locale: AppLocale) =>
  completeAuthCallback(callback).pipe(
    Effect.provideService(SignInLocale, locale)
  );

const leave = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/");
};

/**
 * `/auth/callback`: the magic-link App Link and the handoff return land here,
 * on a warm or a cold start. It finishes the sign-in (once, even if the auth
 * session reports the same URL) and goes back to where the customer was.
 */
export function AuthCallbackScreen() {
  const locale = useAppLocale();
  const {
    token,
    code,
    state: handoffState,
    error,
    method,
  } = useLocalSearchParams();
  // A second link may reuse this screen with new params; each distinct
  // callback is finished (the registry dedupes repeats of the same one).
  const callback = useMemo(
    () =>
      parseAuthCallbackParams({
        token,
        code,
        state: handoffState,
        error,
        method,
      }),
    [token, code, handoffState, error, method]
  );
  const session = useAuthSession();
  const { state, start } = useAuthTask(
    nativeAuthRuntime,
    completeCallback,
    unexpected
  );

  useEffect(() => {
    void start(callback, locale);
  }, [start, callback, locale]);

  const completed = state.status === "succeeded";
  const signedIn = session.status === "signed-in";
  useEffect(() => {
    if (completed && signedIn) leave();
  }, [completed, signedIn]);

  return (
    <Screen title={m.signin_title({}, { locale })}>
      {/* The status message below says what's under way. */}
      {state.status !== "failed" && (
        <LoadingIndicator size="screen" tone="brand" />
      )}
      <LiveMessage
        role="status"
        message={
          state.status === "failed"
            ? undefined
            : m.callback_completing({}, { locale })
        }
      />
      <LiveMessage
        role="alert"
        message={
          state.status === "failed"
            ? nativeSignInFailureMessage(state.failure, locale)
            : undefined
        }
      />
      {/* A refused callback leaves a signed-in app signed in, as when a
          reauthentication lands on another account: it goes back to where
          it was, not to sign-in. */}
      {state.status === "failed" &&
        (signedIn ? (
          <Button label={m.callback_go_back({}, { locale })} onPress={leave} />
        ) : (
          <Button
            label={m.callback_back_to_sign_in({}, { locale })}
            onPress={() => router.replace("/sign-in")}
          />
        ))}
    </Screen>
  );
}
