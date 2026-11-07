import { Effect, Exit, Option } from "effect";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { trackSignInCompleted, trackSignInStarted } from "../analytics/events";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import {
  BodyText,
  Button,
  LiveMessage,
  Screen,
  TextField,
} from "../ui/controls";
import { type SignInCallbackMethod, withSignInMethod } from "./auth-callback";
import { isFreshSignIn, safeReturnPath } from "./auth-session-state";
import type { NativeHandoffRequest } from "./native-handoff-request";
import { webSignInFailureMessage } from "./sign-in-failure-message";
import type { SignInScreenProps } from "./sign-in-screen.native";
import { useAuthSession } from "./use-auth-session";
import {
  firstFailure,
  firstSuccess,
  standaloneTaskRuntime,
  useAuthTask,
} from "./use-auth-task";
import {
  clearNativeHandoffRequest,
  loadNativeHandoffRequest,
} from "./web-native-request-store";
import { loadReauthenticatingUser } from "./web-reauthentication-store";
import {
  completeWebCodeSignIn,
  completeWebPasskeySignIn,
  mintNativeHandoff,
  prepareNativeHandoffEmail,
  prepareReauthenticationEmail,
  reauthenticationExpectation,
  sendSignInEmail,
  type WebAccountExpectation,
} from "./web-sign-in";
import { WebSignInFailure } from "./web-sign-in-failure";

/** Where a finished sign-in goes: back into the app, or a web route. */
type SignInDestination =
  | { readonly kind: "app"; readonly url: string }
  | { readonly kind: "web" };

/**
 * Mints the handoff for a native request; `method` tells the app how this
 * page signed in, and is absent when it continued an existing session.
 * Without a native request the browser itself completed the sign-in.
 */
const finishSignIn = (
  request: Option.Option<NativeHandoffRequest>,
  method: SignInCallbackMethod | undefined
) =>
  Option.match(request, {
    onNone: () =>
      Effect.sync((): SignInDestination => {
        if (method !== undefined) trackSignInCompleted(method);
        return { kind: "web" };
      }),
    onSome: (found) =>
      mintNativeHandoff(found).pipe(
        Effect.map(
          (url): SignInDestination => ({
            kind: "app",
            url: method === undefined ? url : withSignInMethod(url, method),
          })
        )
      ),
  });

type SignInStep = "continue" | "email" | "code";

const signInStep = (
  continueAs: string | undefined,
  sentTo: string | undefined
): SignInStep => {
  if (continueAs !== undefined) return "continue";
  return sentTo === undefined ? "email" : "code";
};

const signInStatus = ({
  restoring,
  returningToApp,
  sending,
  verifying,
  locale,
}: {
  readonly restoring: boolean;
  readonly returningToApp: boolean;
  readonly sending: boolean;
  readonly verifying: boolean;
  readonly locale: AppLocale;
}): string | undefined => {
  if (restoring) return m.signin_restoring({}, { locale });
  if (returningToApp) return m.signin_returning_to_app({}, { locale });
  if (sending) return m.signin_sending({}, { locale });
  if (verifying) return m.signin_verifying_code({}, { locale });
  return undefined;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const unexpected = () =>
  new WebSignInFailure({ operation: "send-email", reason: "failed" });

/**
 * `/app/sign-in` on the web: email, then the sign-in code (or the link in the
 * email). Opened by the native app with `?native=1`, it hands the finished
 * sign-in back to the app; a fresh browser session can continue without
 * signing in again, unless the app asked to reauthenticate.
 */
export function SignInScreen({ passkeyOption }: SignInScreenProps) {
  const locale = useAppLocale();
  const session = useAuthSession();
  const params = useLocalSearchParams<{
    prompt?: string;
    return_to?: string;
  }>();
  const [nativeRequest] = useState(() => loadNativeHandoffRequest(Date.now()));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string>();
  const [invalidEmail, setInvalidEmail] = useState(false);
  const [useAnotherAccount, setUseAnotherAccount] = useState(false);

  const send = useAuthTask(
    standaloneTaskRuntime,
    (address: string, expectation: WebAccountExpectation) =>
      prepareNativeHandoffEmail({
        openedByApp: Option.isSome(nativeRequest),
        currentRequest: loadNativeHandoffRequest(Date.now()),
      }).pipe(
        Effect.andThen(prepareReauthenticationEmail(expectation)),
        Effect.andThen(sendSignInEmail(address, locale))
      ),
    unexpected
  );
  // A web reauthentication must come back as the account it started from:
  // the one this page's browser session had when the page first read it,
  // else the one stored for it. A later sign-in on this page, by code or by
  // passkey, never replaces it.
  const reauthenticating =
    params.prompt === "login" && Option.isNone(nativeRequest);
  const [pageSession, setPageSession] = useState<{
    readonly userId: string | undefined;
  }>();
  const sessionUserId =
    session.status === "signed-in" ? session.user.id : undefined;
  const sessionRead = session.status !== "restoring";
  useEffect(() => {
    if (sessionRead) {
      setPageSession((known) => known ?? { userId: sessionUserId });
    }
  }, [sessionRead, sessionUserId]);
  const verify = useAuthTask(
    standaloneTaskRuntime,
    (address: string, entered: string, expectation: WebAccountExpectation) =>
      completeWebCodeSignIn(address, entered, expectation).pipe(
        Effect.andThen(finishSignIn(nativeRequest, "code"))
      ),
    unexpected
  );
  const handoff = useAuthTask(standaloneTaskRuntime, finishSignIn, unexpected);
  // The passkey option signed in on this page, so it finishes the same way,
  // after the same account check as a code.
  const passkey = useAuthTask(
    standaloneTaskRuntime,
    (expectation: WebAccountExpectation) =>
      completeWebPasskeySignIn(expectation).pipe(
        Effect.andThen(finishSignIn(nativeRequest, "passkey"))
      ),
    unexpected
  );

  const reauthenticate =
    params.prompt === "login" ||
    Option.exists(nativeRequest, (request) => request.reauthenticate);
  const returnPath = safeReturnPath(params.return_to);
  const finished = firstSuccess(verify.state, handoff.state, passkey.state);

  useEffect(() => {
    if (finished === undefined) return;
    if (finished.kind === "app") {
      clearNativeHandoffRequest();
      globalThis.location.assign(finished.url);
    } else {
      router.replace(returnPath);
    }
  }, [finished, returnPath]);

  if (
    session.status === "signed-in" &&
    Option.isNone(nativeRequest) &&
    !reauthenticate &&
    finished === undefined
  ) {
    return <Redirect href={returnPath} />;
  }

  const continueAs =
    session.status === "signed-in" &&
    Option.isSome(nativeRequest) &&
    !reauthenticate &&
    !useAnotherAccount &&
    isFreshSignIn(session.signedInAt, Date.now()) &&
    handoff.state.status !== "failed"
      ? session.user.email
      : undefined;
  const step = signInStep(continueAs, sentTo);

  const failure = firstFailure(
    handoff.state,
    passkey.state,
    verify.state,
    send.state
  );
  const alert = invalidEmail
    ? m.signin_error_invalid_email({}, { locale })
    : failure && webSignInFailureMessage(failure.reason, locale);
  const busy = [send.state, verify.state, handoff.state, passkey.state].some(
    (state) => state.status === "running"
  );
  const status = signInStatus({
    restoring: session.status === "restoring",
    returningToApp: finished?.kind === "app",
    sending: send.state.status === "running",
    verifying: verify.state.status === "running",
    locale,
  });

  const accountExpectation = () =>
    reauthenticationExpectation({
      reauthenticating,
      sessionUserId: pageSession?.userId,
      storedUserId: reauthenticating
        ? loadReauthenticatingUser(Date.now())
        : Option.none(),
    });

  const handlePasskeySignedIn = () => void passkey.start(accountExpectation());

  const submitEmail = () => {
    const address = email.trim();
    const valid = emailPattern.test(address);
    setInvalidEmail(!valid);
    if (!valid) return;
    void send.start(address, accountExpectation()).then((exit) => {
      if (!Option.exists(exit, Exit.isSuccess)) return;
      trackSignInStarted("link");
      setSentTo(address);
    });
  };

  const submitCode = () => {
    if (sentTo === undefined) return;
    void verify.start(sentTo, code.trim(), accountExpectation());
  };

  const startOver = () => {
    setSentTo(undefined);
    setCode("");
    setUseAnotherAccount(true);
    send.reset();
    verify.reset();
    handoff.reset();
    passkey.reset();
  };

  return (
    <Screen
      title={
        step === "code"
          ? m.signin_sent_title({}, { locale })
          : m.signin_title({}, { locale })
      }
    >
      {reauthenticate && step === "email" && (
        <BodyText>{m.signin_reauthenticate_body({}, { locale })}</BodyText>
      )}
      {step === "continue" && (
        <>
          <BodyText>{m.signin_continue_as_body({}, { locale })}</BodyText>
          <Button
            label={m.signin_continue_as(
              { email: continueAs ?? "" },
              { locale }
            )}
            onPress={() => void handoff.start(nativeRequest, undefined)}
            disabled={busy}
          />
          <Button
            variant="secondary"
            label={m.signin_use_another_email({}, { locale })}
            onPress={startOver}
            disabled={busy}
          />
        </>
      )}
      {step === "email" && (
        <>
          <TextField
            label={m.signin_email_label({}, { locale })}
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={submitEmail}
            autoComplete="email"
            inputMode="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!busy}
          />
          <Button
            label={m.signin_send_link({}, { locale })}
            onPress={submitEmail}
            disabled={busy}
          />
          {passkeyOption?.(handlePasskeySignedIn)}
        </>
      )}
      {step === "code" && (
        <>
          <BodyText>
            {m.signin_sent_body({ email: sentTo ?? "" }, { locale })}
          </BodyText>
          <TextField
            label={m.signin_code_label({}, { locale })}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={submitCode}
            autoComplete="one-time-code"
            inputMode="numeric"
            textContentType="oneTimeCode"
            editable={!busy}
          />
          <Button
            label={m.signin_verify_code({}, { locale })}
            onPress={submitCode}
            disabled={busy || code.trim() === ""}
          />
          <Button
            variant="secondary"
            label={m.signin_use_another_email({}, { locale })}
            onPress={startOver}
            disabled={busy}
          />
        </>
      )}
      <LiveMessage role="status" message={status} />
      <LiveMessage role="alert" message={alert} />
    </Screen>
  );
}
