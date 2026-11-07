import { Effect, Option } from "effect";
import { Redirect } from "expo-router";
import { type ReactNode, useState } from "react";
import { trackSignInCompleted } from "../analytics/events";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { BodyText, Button, LiveMessage, Screen } from "../ui/controls";
import { nativeAuthRuntime } from "./native-auth-runtime";
import { signInWithEmail } from "./native-sign-in";
import { SignInUnavailable } from "./native-sign-in-errors";
import { nativeSignInFailureMessage } from "./sign-in-failure-message";
import { SignInLocale } from "./sign-in-locale";
import { useAuthSession } from "./use-auth-session";
import { useAuthTask } from "./use-auth-task";

const signInStatus = (
  restoring: boolean,
  running: boolean,
  locale: AppLocale
): string | undefined => {
  if (restoring) return m.signin_restoring({}, { locale });
  if (running) return m.signin_in_progress({}, { locale });
  return undefined;
};

/**
 * What the sign-in screen gives its passkey option. A screen runs one
 * sign-in method at a time, so a ceremony can't change the session while
 * another method finishes, or the other way round.
 */
export interface PasskeyOptionProps {
  /**
   * Runs once the passkey has signed in: it records the sign-in and, on the
   * web page, checks the account and hands the session to the app that asked
   * for it.
   */
  readonly onSignedIn: () => void;
  /** Another sign-in method is running, so the option can't start. */
  readonly disabled: boolean;
  /**
   * Called with `true` before the option's ceremony can change the session,
   * and with `false` only once `onSignedIn` has run or the ceremony ended.
   */
  readonly onPendingChange: (pending: boolean) => void;
}

/**
 * The sign-in screen's props. `passkeyOption` renders the passkey sign-in
 * option, which is delivered separately.
 */
export interface SignInScreenProps {
  readonly passkeyOption?: (option: PasskeyOptionProps) => ReactNode;
}

const recordPasskeySignIn = (): void => trackSignInCompleted("passkey");

const signInWithEmailNow = (locale: AppLocale) =>
  signInWithEmail(Option.none()).pipe(
    Effect.provideService(SignInLocale, locale)
  );
const unexpected = () => new SignInUnavailable({});

/**
 * The native sign-in screen. "Continue with email" opens the web sign-in
 * page in an in-app auth session; the session lands back here through the
 * callback, and the signed-in state redirects home.
 */
export function SignInScreen({ passkeyOption }: SignInScreenProps) {
  const locale = useAppLocale();
  const session = useAuthSession();
  const { state, start, reset } = useAuthTask(
    nativeAuthRuntime,
    signInWithEmailNow,
    unexpected
  );

  const [passkeyPending, setPasskeyPending] = useState(false);
  // A passkey attempt replaces the email sign-in's earlier failure, so its
  // alert doesn't stay up during and after the attempt.
  const handlePasskeyPendingChange = (pending: boolean) => {
    if (pending) reset();
    setPasskeyPending(pending);
  };

  if (session.status === "signed-in") return <Redirect href="/" />;

  const restoring = session.status === "restoring";
  const running = state.status === "running";
  return (
    <Screen title={m.signin_title({}, { locale })}>
      <BodyText>{m.signin_intro_native({}, { locale })}</BodyText>
      <Button
        label={m.signin_continue_with_email({}, { locale })}
        onPress={() => void start(locale)}
        disabled={restoring || running || passkeyPending}
      />
      {passkeyOption?.({
        onSignedIn: recordPasskeySignIn,
        disabled: restoring || running,
        onPendingChange: handlePasskeyPendingChange,
      })}
      <LiveMessage
        role="status"
        message={signInStatus(restoring, running, locale)}
      />
      <LiveMessage
        role="alert"
        message={
          state.status === "failed"
            ? nativeSignInFailureMessage(state.failure, locale)
            : undefined
        }
      />
    </Screen>
  );
}
