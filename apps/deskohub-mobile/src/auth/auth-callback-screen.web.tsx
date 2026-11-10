import { Effect, Match, Option } from "effect";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { trackSignInCompleted } from "../analytics/events";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { BodyText, Button, LiveMessage, Screen } from "../ui/controls";
import { LoadingIndicator } from "../ui/loading-indicator";
import { type AuthCallback, withSignInMethod } from "./auth-callback";
import { capturedAuthCallback } from "./auth-location.web";
import type { NativeHandoffRequest } from "./native-handoff-request";
import { webSignInFailureMessage } from "./sign-in-failure-message";
import { useAuthSession } from "./use-auth-session";
import {
  firstFailure,
  standaloneTaskRuntime,
  useAuthTask,
} from "./use-auth-task";
import {
  clearNativeHandoffRequest,
  loadNativeHandoffRequest,
} from "./web-native-request-store";
import {
  loadReauthentication,
  type StoredReauthentication,
} from "./web-reauthentication-store";
import { completeWebMagicLink, mintNativeHandoff } from "./web-sign-in";
import { WebSignInFailure } from "./web-sign-in-failure";

const linkRejected = () =>
  new WebSignInFailure({ operation: "verify-link", reason: "link-rejected" });

/** Only a magic-link token signs in on the web; anything else is refused. */
const completeWebCallback = (
  callback: AuthCallback,
  nativePending: boolean,
  reauthentication: Option.Option<StoredReauthentication>,
  locale: AppLocale
) =>
  Match.value(callback).pipe(
    Match.discriminatorsExhaustive("kind")({
      token: ({ token }) =>
        completeWebMagicLink(
          token,
          {
            nativePending,
            storedUserId: Option.map(reauthentication, ({ userId }) => userId),
          },
          locale
        ),
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

/** The app records this sign-in, so the URL says it came from the link. */
const mintLinkHandoff = (request: NativeHandoffRequest) =>
  mintNativeHandoff(request).pipe(
    Effect.map((url) => withSignInMethod(url, "link"))
  );

/**
 * How long a verified link waits for the app to read its session before it
 * routes on anyway. The read normally lands within a moment.
 */
const sessionReadWaitMs = 5000;

const unexpected = () =>
  new WebSignInFailure({ operation: "verify-link", reason: "failed" });

/**
 * `/app/auth/callback` in a browser: the magic link opened here instead of
 * in the app. It signs the browser in; if the app started this sign-in, the
 * customer can send the session on to it with "Open in app".
 */
export function AuthCallbackScreen() {
  const locale = useAppLocale();
  const session = useAuthSession();
  const [callback] = useState(capturedAuthCallback);
  const [nativeRequest] = useState(() => loadNativeHandoffRequest(Date.now()));
  // Read before verifying: a confirmed sign-in clears it. A reauthentication
  // returns to the screen that asked for it, else home.
  const [reauthentication] = useState(() => loadReauthentication(Date.now()));
  const returnPath = Option.getOrElse(
    Option.flatMap(reauthentication, (stored) => stored.returnPath),
    () => "/"
  );
  const verify = useAuthTask(
    standaloneTaskRuntime,
    completeWebCallback,
    unexpected
  );
  const handoff = useAuthTask(
    standaloneTaskRuntime,
    mintLinkHandoff,
    unexpected
  );

  useEffect(() => {
    void verify.start(
      callback,
      Option.isSome(nativeRequest),
      reauthentication,
      locale
    );
  }, [verify.start, callback, nativeRequest, reauthentication, locale]);

  const verified = verify.state.status === "succeeded";
  const offerApp = verified && Option.isSome(nativeRequest);
  // The verify refreshes the app's session after it returns. Routing on
  // before that read lands would send the signed-in screen back to sign-in,
  // so a verified link waits for it, for a few seconds at most.
  const [sessionWaitOver, setSessionWaitOver] = useState(false);
  useEffect(() => {
    if (!verified) return;
    const timer = setTimeout(() => setSessionWaitOver(true), sessionReadWaitMs);
    return () => clearTimeout(timer);
  }, [verified]);
  const sessionReady =
    verified && (session.status === "signed-in" || sessionWaitOver);
  const routingOn = verified && !offerApp;
  useEffect(() => {
    if (!routingOn || !sessionReady) return;
    trackSignInCompleted("link");
    router.replace(returnPath);
  }, [routingOn, sessionReady, returnPath]);

  const appUrl =
    handoff.state.status === "succeeded" ? handoff.state.value : undefined;
  useEffect(() => {
    if (appUrl === undefined) return;
    clearNativeHandoffRequest();
    globalThis.location.assign(appUrl);
  }, [appUrl]);

  const failure = firstFailure(handoff.state, verify.state);
  const verifying =
    verify.state.status === "idle" ||
    verify.state.status === "running" ||
    (routingOn && !sessionReady);
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
            disabled={!sessionReady}
            onPress={() => {
              clearNativeHandoffRequest();
              trackSignInCompleted("link");
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
      {/* The status message below says what's under way. */}
      {status !== undefined && <LoadingIndicator size="screen" tone="brand" />}
      <LiveMessage role="status" message={status} />
      <LiveMessage
        role="alert"
        message={failure && webSignInFailureMessage(failure.reason, locale)}
      />
    </Screen>
  );
}
