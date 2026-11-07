import { Effect, Match, Option } from "effect";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { BodyText, Button, LiveMessage, Screen } from "../ui/controls";
import type { AuthCallback } from "./auth-callback";
import { capturedAuthCallback } from "./auth-location.web";
import { webSignInFailureMessage } from "./sign-in-failure-message";
import {
  firstFailure,
  standaloneTaskRuntime,
  useAuthTask,
} from "./use-auth-task";
import {
  clearNativeHandoffRequest,
  loadNativeHandoffRequest,
} from "./web-native-request-store";
import { mintNativeHandoff, verifyMagicLinkToken } from "./web-sign-in";
import { WebSignInFailure } from "./web-sign-in-failure";

const linkRejected = () =>
  new WebSignInFailure({ operation: "verify-link", reason: "link-rejected" });

/** Only a magic-link token signs in on the web; anything else is refused. */
const completeWebCallback = (callback: AuthCallback) =>
  Match.value(callback).pipe(
    Match.discriminatorsExhaustive("kind")({
      token: ({ token }) => verifyMagicLinkToken(token),
      handoff: () => Effect.fail(linkRejected()),
      error: () => Effect.fail(linkRejected()),
      invalid: () => Effect.fail(linkRejected()),
    })
  );

const callbackStatus = (
  verifying: boolean,
  returningToApp: boolean,
  locale: AppLocale
): string | undefined => {
  if (returningToApp) return m.signin_returning_to_app({}, { locale });
  if (verifying) return m.callback_completing({}, { locale });
  return undefined;
};

const unexpected = () =>
  new WebSignInFailure({ operation: "verify-link", reason: "failed" });

/**
 * `/app/auth/callback` in a browser: the magic link opened here instead of
 * in the app. It signs the browser in; if the app started this sign-in, the
 * customer can send the session on to it with "Open in app".
 */
export function AuthCallbackScreen() {
  const locale = useAppLocale();
  const [callback] = useState(capturedAuthCallback);
  const [nativeRequest] = useState(() => loadNativeHandoffRequest(Date.now()));
  const verify = useAuthTask(
    standaloneTaskRuntime,
    completeWebCallback,
    unexpected
  );
  const handoff = useAuthTask(
    standaloneTaskRuntime,
    mintNativeHandoff,
    unexpected
  );

  useEffect(() => {
    // The address bar was cleaned before the router started; drop the
    // router's copy too, so a later URL sync can't write the token back.
    router.setParams({
      token: undefined,
      code: undefined,
      state: undefined,
      error: undefined,
    });
    void verify.start(callback);
  }, [verify.start, callback]);

  const verified = verify.state.status === "succeeded";
  const offerApp = verified && Option.isSome(nativeRequest);
  useEffect(() => {
    if (verified && !offerApp) router.replace("/");
  }, [verified, offerApp]);

  const appUrl =
    handoff.state.status === "succeeded" ? handoff.state.value : undefined;
  useEffect(() => {
    if (appUrl === undefined) return;
    clearNativeHandoffRequest();
    globalThis.location.assign(appUrl);
  }, [appUrl]);

  const failure = firstFailure(handoff.state, verify.state);
  const verifying =
    verify.state.status === "idle" || verify.state.status === "running";
  const status = callbackStatus(verifying, appUrl !== undefined, locale);

  return (
    <Screen title={m.signin_title({}, { locale })}>
      {offerApp && (
        <>
          <BodyText>{m.callback_signed_in_web({}, { locale })}</BodyText>
          {Option.match(nativeRequest, {
            onNone: () => null,
            onSome: (request) => (
              <Button
                label={m.callback_open_in_app({}, { locale })}
                onPress={() => void handoff.start(request)}
                disabled={handoff.state.status === "running"}
              />
            ),
          })}
          <Button
            variant="secondary"
            label={m.callback_continue_here({}, { locale })}
            onPress={() => {
              clearNativeHandoffRequest();
              router.replace("/");
            }}
          />
        </>
      )}
      {verify.state.status === "failed" && (
        <Button
          label={m.callback_back_to_sign_in({}, { locale })}
          onPress={() => router.replace("/sign-in")}
        />
      )}
      <LiveMessage role="status" message={status} />
      <LiveMessage
        role="alert"
        message={failure && webSignInFailureMessage(failure.reason, locale)}
      />
    </Screen>
  );
}
