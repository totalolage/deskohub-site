import { Effect, Exit, Option } from "effect";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
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
import { isFreshSignIn, safeReturnPath } from "./auth-session-state";
import type { NativeHandoffRequest } from "./native-handoff-request";
import { webSignInFailureMessage } from "./sign-in-failure-message";
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
import {
  mintNativeHandoff,
  sendSignInEmail,
  verifySignInCode,
} from "./web-sign-in";
import { WebSignInFailure } from "./web-sign-in-failure";

/** Where a finished sign-in goes: back into the app, or a web route. */
type SignInDestination =
  | { readonly kind: "app"; readonly url: string }
  | { readonly kind: "web" };

const finishSignIn = (request: Option.Option<NativeHandoffRequest>) =>
  Option.match(request, {
    onNone: () => Effect.succeed<SignInDestination>({ kind: "web" }),
    onSome: (found) =>
      mintNativeHandoff(found).pipe(
        Effect.map((url): SignInDestination => ({ kind: "app", url }))
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
export function SignInScreen() {
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

  const send = useAuthTask(standaloneTaskRuntime, sendSignInEmail, unexpected);
  const verify = useAuthTask(
    standaloneTaskRuntime,
    (address: string, entered: string) =>
      verifySignInCode(address, entered).pipe(
        Effect.andThen(finishSignIn(nativeRequest))
      ),
    unexpected
  );
  const handoff = useAuthTask(standaloneTaskRuntime, finishSignIn, unexpected);

  const reauthenticate =
    params.prompt === "login" ||
    Option.exists(nativeRequest, (request) => request.reauthenticate);
  const returnPath = safeReturnPath(params.return_to);
  const finished = firstSuccess(verify.state, handoff.state);

  useEffect(() => {
    // The native request moved to localStorage before the router started;
    // drop the router's copy of its params as well.
    router.setParams({
      native: undefined,
      code_challenge: undefined,
      code_challenge_method: undefined,
      state: undefined,
      return_uri: undefined,
    });
  }, []);

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

  const failure = firstFailure(handoff.state, verify.state, send.state);
  const alert = invalidEmail
    ? m.signin_error_invalid_email({}, { locale })
    : failure && webSignInFailureMessage(failure.reason, locale);
  const busy = [send.state, verify.state, handoff.state].some(
    (state) => state.status === "running"
  );
  const status = signInStatus({
    restoring: session.status === "restoring",
    returningToApp: finished?.kind === "app",
    sending: send.state.status === "running",
    verifying: verify.state.status === "running",
    locale,
  });

  const submitEmail = () => {
    const address = email.trim();
    const valid = emailPattern.test(address);
    setInvalidEmail(!valid);
    if (!valid) return;
    void send.start(address, locale).then((exit) => {
      if (Option.exists(exit, Exit.isSuccess)) setSentTo(address);
    });
  };

  const submitCode = () => {
    if (sentTo !== undefined) void verify.start(sentTo, code.trim());
  };

  const startOver = () => {
    setSentTo(undefined);
    setCode("");
    setUseAnotherAccount(true);
    send.reset();
    verify.reset();
    handoff.reset();
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
            onPress={() => void handoff.start(nativeRequest)}
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
          {/*
            Passkey slot: the signin-passkeys stream's web passkey sign-in
            option renders here, wired in when the streams are integrated.
          */}
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
