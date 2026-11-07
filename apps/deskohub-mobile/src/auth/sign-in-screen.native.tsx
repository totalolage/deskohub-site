import { Option } from "effect";
import { Redirect } from "expo-router";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { BodyText, Button, LiveMessage, Screen } from "../ui/controls";
import { nativeAuthRuntime } from "./native-auth-runtime";
import { signInWithEmail } from "./native-sign-in";
import { SignInUnavailable } from "./native-sign-in-errors";
import { nativeSignInFailureMessage } from "./sign-in-failure-message";
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

const signInWithEmailNow = () => signInWithEmail(Option.none());
const unexpected = () => new SignInUnavailable({});

/**
 * The native sign-in screen. "Continue with email" opens the web sign-in
 * page in an in-app auth session; the session lands back here through the
 * callback, and the signed-in state redirects home.
 */
export function SignInScreen() {
  const locale = useAppLocale();
  const session = useAuthSession();
  const { state, start } = useAuthTask(
    nativeAuthRuntime,
    signInWithEmailNow,
    unexpected
  );

  if (session.status === "signed-in") return <Redirect href="/" />;

  const restoring = session.status === "restoring";
  const running = state.status === "running";
  return (
    <Screen title={m.signin_title({}, { locale })}>
      <BodyText>{m.signin_intro_native({}, { locale })}</BodyText>
      <Button
        label={m.signin_continue_with_email({}, { locale })}
        onPress={() => void start()}
        disabled={restoring || running}
      />
      {/*
        Passkey slot: the signin-passkeys stream's native passkey sign-in
        option renders here, wired in when the streams are integrated.
      */}
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
