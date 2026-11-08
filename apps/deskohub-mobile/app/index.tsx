import { Link } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { AddPasskeyAction } from "../src/auth/passkey/add-passkey-action";
import {
  type ReauthenticationOutcome,
  useReauthentication,
} from "../src/auth/reauthentication";
import {
  reauthenticationNotice,
  reauthenticationNoticeMessage,
} from "../src/auth/reauthentication-notice";
import { SignOutFailure, signOut } from "../src/auth/sign-out";
import { useAuthSession } from "../src/auth/use-auth-session";
import { standaloneTaskRuntime, useAuthTask } from "../src/auth/use-auth-task";
import { useAppLocale } from "../src/i18n/locale-context";
import { m } from "../src/i18n/messages";
import { theme } from "../src/theme";
import { Button, LiveMessage, Screen } from "../src/ui/controls";

const runSignOut = () => signOut;
const unexpected = () => new SignOutFailure();

export default function HomeScreen() {
  const locale = useAppLocale();
  const session = useAuthSession();
  const { state, start } = useAuthTask(
    standaloneTaskRuntime,
    runSignOut,
    unexpected
  );
  const reauthentication = useReauthentication();
  const [reauthenticationOutcome, setReauthenticationOutcome] = useState<
    ReauthenticationOutcome | undefined
  >();
  const notice = reauthenticationNotice(
    reauthentication.state,
    reauthenticationOutcome
  );

  // Adding a passkey needs a recent sign-in. Once the customer has signed in
  // again, the notice asks them to add the passkey again.
  const reauthenticateToAddPasskey = async () => {
    setReauthenticationOutcome(undefined);
    setReauthenticationOutcome(await reauthentication.reauthenticate());
  };

  return (
    <Screen title={m.home_title({}, { locale })} align="center">
      <Text style={styles.tagline}>{m.home_tagline({}, { locale })}</Text>
      {session.status === "signed-in" && (
        <Text style={styles.tagline}>
          {m.home_signed_in_as({ email: session.user.email }, { locale })}
        </Text>
      )}
      <AddPasskeyAction
        onAdded={() => setReauthenticationOutcome(undefined)}
        onReauthenticationRequired={() => void reauthenticateToAddPasskey()}
      />
      <LiveMessage
        role="status"
        message={
          notice !== undefined && notice.kind !== "failed"
            ? reauthenticationNoticeMessage(notice, locale)
            : undefined
        }
      />
      <LiveMessage
        role="alert"
        message={
          notice?.kind === "failed"
            ? reauthenticationNoticeMessage(notice, locale)
            : undefined
        }
      />
      <Button
        variant="secondary"
        label={m.home_sign_out({}, { locale })}
        onPress={() => void start()}
        disabled={state.status === "running"}
      />
      <LiveMessage
        role="status"
        message={
          state.status === "running"
            ? m.home_signing_out({}, { locale })
            : undefined
        }
      />
      <LiveMessage
        role="alert"
        message={
          state.status === "failed"
            ? m.home_sign_out_failed({}, { locale })
            : undefined
        }
      />
      {__DEV__ && (
        <Link href="/dev/effect-smoke" style={styles.devLink}>
          {m.home_smoke_link({}, { locale })}
        </Link>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tagline: {
    color: theme.colors.textMuted,
    textAlign: "center",
    ...theme.type.body,
  },
  devLink: {
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    color: theme.colors.accent,
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    ...theme.type.body,
  },
});
