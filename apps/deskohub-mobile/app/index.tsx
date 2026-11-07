import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SignOutFailure, signOut } from "../src/auth/sign-out";
import { useAuthSession } from "../src/auth/use-auth-session";
import { standaloneTaskRuntime, useAuthTask } from "../src/auth/use-auth-task";
import { useAppLocale } from "../src/i18n/locale-context";
import { m } from "../src/i18n/messages";
import { theme } from "../src/theme";
import { Button, LiveMessage } from "../src/ui/controls";

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

  return (
    <View style={styles.screen}>
      <Text role="heading" style={styles.title}>
        {m.home_title({}, { locale })}
      </Text>
      <Text style={styles.tagline}>{m.home_tagline({}, { locale })}</Text>
      {session.status === "signed-in" && (
        <Text style={styles.tagline}>
          {m.home_signed_in_as({ email: session.user.email }, { locale })}
        </Text>
      )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: theme.colors.background,
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.text, ...theme.type.title },
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
