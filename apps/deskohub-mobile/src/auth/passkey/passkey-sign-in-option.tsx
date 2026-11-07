import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { passkeyCeremonies } from "./passkey-ceremonies";
import { passkeySignInFailureMessage } from "./passkey-failure-message";
import { usePasskeyCeremony } from "./use-passkey-ceremony";

/**
 * Signs in with a passkey saved for Deskohub. `onSignedIn` runs once the
 * session exists; the auth client's session has already refreshed.
 */
export function PasskeySignInOption({
  onSignedIn,
}: {
  readonly onSignedIn: () => void;
}) {
  const locale = useAppLocale();
  const { state, start } = usePasskeyCeremony({
    ceremony: () => passkeyCeremonies.signIn,
    onSucceeded: onSignedIn,
  });
  const pending = state.status === "pending";

  return (
    <View style={styles.option}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending }}
        accessibilityLabel={
          pending
            ? m.passkey_sign_in_pending({}, { locale })
            : m.passkey_sign_in({}, { locale })
        }
        disabled={pending}
        onPress={start}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        {pending && <ActivityIndicator color={theme.colors.background} />}
        <Text style={styles.label}>{m.passkey_sign_in({}, { locale })}</Text>
      </Pressable>
      <Text
        accessibilityLiveRegion="assertive"
        role="alert"
        style={styles.error}
      >
        {state.status === "failed"
          ? passkeySignInFailureMessage(state.failure, locale)
          : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  option: { alignSelf: "stretch", gap: theme.spacing.sm },
  button: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    gap: theme.spacing.sm,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
  },
  pressed: { opacity: 0.8 },
  label: { color: theme.colors.background, ...theme.type.body },
  error: { color: theme.colors.text, ...theme.type.body },
});
