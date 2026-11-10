import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { trackSignInStarted } from "../../analytics/events";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { LiveMessage } from "../../ui/controls";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { Text } from "../../ui/text";
import { passkeySignInFailureMessage } from "./passkey-failure-message";
import { usePasskeyCeremony } from "./use-passkey-ceremony";

/**
 * Signs in with a passkey saved for Deskohub. `onSignedIn` runs once the
 * session exists and the auth client has been told to refresh it; its
 * session data may still be loading. `onPendingChange` reports while the
 * ceremony may change the session, and `disabled` holds the option while
 * another sign-in method runs.
 */
export function PasskeySignInOption({
  onSignedIn,
  disabled = false,
  onPendingChange,
}: {
  readonly onSignedIn: () => void;
  readonly disabled?: boolean;
  readonly onPendingChange?: (pending: boolean) => void;
}) {
  const locale = useAppLocale();
  const { state, start, clearFailure } = usePasskeyCeremony({
    ceremony: (ceremonies) => ceremonies.signIn,
    onSucceeded: onSignedIn,
    // A ceremony goes pending as it starts, so this records each attempt once.
    onPendingChange: (pending) => {
      if (pending) trackSignInStarted("passkey");
      onPendingChange?.(pending);
    },
  });
  const pending = state.status === "pending";
  // Another sign-in method starting holds this option; its earlier failure
  // then gives way to that attempt.
  useEffect(() => {
    if (disabled) clearFailure();
  }, [disabled, clearFailure]);

  return (
    <View style={styles.option}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending || disabled }}
        accessibilityLabel={
          pending
            ? m.passkey_sign_in_pending({}, { locale })
            : m.passkey_sign_in({}, { locale })
        }
        disabled={pending || disabled}
        onPress={start}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        {pending && <LoadingIndicator size="inline" tone="navy" />}
        <Text style={styles.label}>{m.passkey_sign_in({}, { locale })}</Text>
      </Pressable>
      {/* Kept mounted so assistive tech announces each change. */}
      <LiveMessage
        role="alert"
        message={
          state.status === "failed"
            ? passkeySignInFailureMessage(state.failure, locale)
            : undefined
        }
      />
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
});
