import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Button, LiveMessage, Screen } from "../ui/controls";
import { parseAuthCallbackParams } from "./auth-callback";
import { nativeAuthRuntime } from "./native-auth-runtime";
import { completeAuthCallback } from "./native-sign-in";
import { SignInUnavailable } from "./native-sign-in-errors";
import { nativeSignInFailureMessage } from "./sign-in-failure-message";
import { useAuthSession } from "./use-auth-session";
import { useAuthTask } from "./use-auth-task";

const unexpected = () => new SignInUnavailable({});

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
  const { token, code, state: handoffState, error } = useLocalSearchParams();
  // A second link may reuse this screen with new params; each distinct
  // callback is finished (the registry dedupes repeats of the same one).
  const callback = useMemo(
    () => parseAuthCallbackParams({ token, code, state: handoffState, error }),
    [token, code, handoffState, error]
  );
  const session = useAuthSession();
  const { state, start } = useAuthTask(
    nativeAuthRuntime,
    completeAuthCallback,
    unexpected
  );

  useEffect(() => {
    void start(callback);
  }, [start, callback]);

  const completed = state.status === "succeeded";
  const signedIn = session.status === "signed-in";
  useEffect(() => {
    if (completed && signedIn) leave();
  }, [completed, signedIn]);

  return (
    <Screen title={m.signin_title({}, { locale })}>
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
      {state.status === "failed" && (
        <Button
          label={m.callback_back_to_sign_in({}, { locale })}
          onPress={() => router.replace("/sign-in")}
        />
      )}
    </Screen>
  );
}
