import { Match } from "effect";
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
import type { AddedPasskey } from "./passkey-ceremony";
import { addPasskeyFailureMessage } from "./passkey-failure-message";
import { usePasskeyCeremony } from "./use-passkey-ceremony";

/**
 * Saves a new passkey to the signed-in account. Adding one needs a recent
 * sign-in: when the session is too old, the action calls
 * `onReauthenticationRequired` and returns to idle, so the customer can try
 * again once they have signed in again.
 */
export function AddPasskeyAction({
  name,
  onAdded,
  onReauthenticationRequired,
}: {
  /** The passkey's name; the server names it after its provider otherwise. */
  readonly name?: string;
  readonly onAdded?: (passkey: AddedPasskey) => void;
  readonly onReauthenticationRequired: () => void;
}) {
  const locale = useAppLocale();
  const { state, start } = usePasskeyCeremony({
    ceremony: () => passkeyCeremonies.addPasskey({ name }),
    onSucceeded: onAdded,
    takeOver: (failure) => {
      if (
        failure._tag !== "PasskeyRejected" ||
        !failure.needsReauthentication
      ) {
        return false;
      }
      onReauthenticationRequired();
      return true;
    },
  });
  const pending = state.status === "pending";
  const status = Match.value(state).pipe(
    Match.discriminatorsExhaustive("status")({
      idle: () => "",
      pending: () => "",
      succeeded: () => m.passkey_added({}, { locale }),
      failed: ({ failure }) => addPasskeyFailureMessage(failure, locale),
    })
  );

  return (
    <View style={styles.action}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending }}
        accessibilityLabel={
          pending
            ? m.passkey_add_pending({}, { locale })
            : m.passkey_add({}, { locale })
        }
        disabled={pending}
        onPress={start}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        {pending && <ActivityIndicator color={theme.colors.accent} />}
        <Text style={styles.label}>{m.passkey_add({}, { locale })}</Text>
      </Pressable>
      <Text
        accessibilityLiveRegion="polite"
        role="status"
        style={styles.status}
      >
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: "stretch", gap: theme.spacing.sm },
  button: {
    alignItems: "center",
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: theme.spacing.sm,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
  },
  pressed: { opacity: 0.8 },
  label: { color: theme.colors.accent, ...theme.type.body },
  status: { color: theme.colors.text, ...theme.type.body },
});
