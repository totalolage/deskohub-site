import { Effect, Exit, Option } from "effect";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { trackSignInStarted } from "../analytics/events";
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
import {
  type AuthUser,
  isFreshSignIn,
  safeReturnPath,
} from "./auth-session-state";
import { webSignInFailureMessage } from "./sign-in-failure-message";
import type { SignInScreenProps } from "./sign-in-screen.native";
import { signInStep } from "./sign-in-step";
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
  finishSignIn,
  prepareNativeHandoffEmail,
  prepareReauthenticationEmail,
  reauthenticationExpectation,
  type SentSignInEmail,
  sendSignInEmail,
  signInEmailField,
  type WebAccountExpectation,
} from "./web-sign-in";
import { WebSignInFailure } from "./web-sign-in-failure";

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
 * email), or only the link when the email carries no code. Opened by the native app with `?native=1`, it hands the finished
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
  const [sent, setSent] = useState<SentSignInEmail>();
  const [invalidEmail, setInvalidEmail] = useState(false);
  const [useAnotherAccount, setUseAnotherAccount] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const returnPath = safeReturnPath(params.return_to);

  const send = useAuthTask(
    standaloneTaskRuntime,
    (address: string, expectation: WebAccountExpectation) =>
      prepareNativeHandoffEmail({
        openedByApp: Option.isSome(nativeRequest),
        currentRequest: loadNativeHandoffRequest(Date.now()),
      }).pipe(
        Effect.andThen(prepareReauthenticationEmail(expectation, returnPath)),
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
    readonly user: AuthUser | undefined;
  }>();
  const sessionUserId =
    session.status === "signed-in" ? session.user.id : undefined;
  const sessionEmail =
    session.status === "signed-in" ? session.user.email : undefined;
  const sessionRead = session.status !== "restoring";
  useEffect(() => {
    if (!sessionRead) return;
    const user =
      sessionUserId === undefined || sessionEmail === undefined
        ? undefined
        : { id: sessionUserId, email: sessionEmail };
    setPageSession((known) => known ?? { user });
  }, [sessionRead, sessionUserId, sessionEmail]);
  // Its email goes only to that account, through any start over.
  const emailField = signInEmailField({ reauthenticating, pageSession });
  const verify = useAuthTask(
    standaloneTaskRuntime,
    (address: string, entered: string, expectation: WebAccountExpectation) =>
      completeWebCodeSignIn(address, entered, expectation, locale).pipe(
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

  // A passkey sign-in being finished routes on once it is done, so the
  // session it created doesn't redirect before then.
  const finishingPasskey = passkey.state.status === "running";
  if (
    session.status === "signed-in" &&
    Option.isNone(nativeRequest) &&
    !reauthenticate &&
    !finishingPasskey &&
    finished === undefined
  ) {
    return <Redirect href={returnPath} />;
  }

  const continueAs =
    session.status === "signed-in" &&
    Option.isSome(nativeRequest) &&
    !reauthenticate &&
    !useAnotherAccount &&
    !finishingPasskey &&
    isFreshSignIn(session.signedInAt, Date.now()) &&
    handoff.state.status !== "failed"
      ? session.user.email
      : undefined;
  const step = signInStep(continueAs, sent);

  const failure = firstFailure(
    handoff.state,
    passkey.state,
    verify.state,
    send.state
  );
  const alert = invalidEmail
    ? m.signin_error_invalid_email({}, { locale })
    : failure && webSignInFailureMessage(failure.reason, locale);
  // One sign-in method at a time: a passkey ceremony holds the others from
  // its prompt until its sign-in is checked, and they hold it.
  const busy =
    passkeyPending ||
    [send.state, verify.state, handoff.state, passkey.state].some(
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
      sessionUserId: pageSession?.user?.id,
      storedUserId: reauthenticating
        ? loadReauthenticatingUser(Date.now())
        : Option.none(),
    });

  const handlePasskeySignedIn = () => void passkey.start(accountExpectation());

  // Enter in a field submits too, so each submission checks that no other
  // sign-in method is running.
  const submitEmail = () => {
    if (busy || emailField.kind === "waiting") return;
    const address =
      emailField.kind === "locked" ? emailField.email : email.trim();
    const valid = emailPattern.test(address);
    setInvalidEmail(!valid);
    if (!valid) return;
    void send.start(address, accountExpectation()).then((exit) => {
      const sentEmail = Option.flatMap(exit, Exit.getSuccess);
      if (Option.isNone(sentEmail)) return;
      trackSignInStarted("link");
      setSent(sentEmail.value);
    });
  };

  const submitCode = () => {
    if (busy || sent?.signInCode !== true) return;
    void verify.start(sent.email, code.trim(), accountExpectation());
  };

  const startOver = () => {
    setSent(undefined);
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
        step === "code" || step === "link"
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
            onPress={() => void handoff.start(nativeRequest, "continue")}
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
            value={emailField.kind === "locked" ? emailField.email : email}
            onChangeText={setEmail}
            onSubmitEditing={submitEmail}
            autoComplete="email"
            inputMode="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!busy && emailField.kind !== "locked"}
          />
          <Button
            label={m.signin_send_link({}, { locale })}
            onPress={submitEmail}
            disabled={busy || emailField.kind === "waiting"}
          />
        </>
      )}
      {step === "code" && (
        <>
          <BodyText>
            {m.signin_sent_code_body({ email: sent?.email ?? "" }, { locale })}
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
      {step === "link" && (
        <>
          <BodyText>
            {m.signin_sent_link_body({ email: sent?.email ?? "" }, { locale })}
          </BodyText>
          <Button
            variant="secondary"
            label={m.signin_use_another_email({}, { locale })}
            onPress={startOver}
            disabled={busy}
          />
        </>
      )}
      {/* Mounted across the steps, so a step change can't interrupt a
          passkey ceremony before its sign-in is checked. It waits for the
          page's first session read, which fixes the account a
          reauthentication expects. */}
      {pageSession !== undefined &&
        passkeyOption?.({
          onSignedIn: handlePasskeySignedIn,
          disabled: busy,
          onPendingChange: setPasskeyPending,
        })}
      <LiveMessage role="status" message={status} />
      <LiveMessage role="alert" message={alert} />
    </Screen>
  );
}
