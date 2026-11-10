import { Match } from "effect";
import { Pressable, StyleSheet, View } from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { LiveMessage } from "../../ui/controls";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { Text } from "../../ui/text";
import type { AddedPasskey } from "./passkey-ceremony";
import { addPasskeyFailureMessage } from "./passkey-failure-message";
import { usePasskeyCeremony } from "./use-passkey-ceremony";

/**
 * Saves a new passkey to the signed-in account. Adding one needs a recent
 * sign-in: when the session is too old, the action calls
 * `onReauthenticationRequired` and returns to idle, so the customer can try
 * again once they have signed in again. `onStart` runs before the passkey
 * prompt opens and `onSettled` once the ceremony has ended, after `onAdded`
 * or `onReauthenticationRequired`, so the screen can hold its other
 * controls and announce the progress meanwhile.
 */
export function AddPasskeyAction({
  name,
  onAdded,
  onReauthenticationRequired,
  onStart,
  onSettled,
}: {
  /** The passkey's name; the server names it after its provider otherwise. */
  readonly name?: string;
  readonly onAdded?: (passkey: AddedPasskey) => void;
  readonly onReauthenticationRequired: () => void;
  readonly onStart?: () => void;
  readonly onSettled?: () => void;
}) {
  const locale = useAppLocale();
  const { state, start } = usePasskeyCeremony({
    ceremony: (ceremonies) => ceremonies.addPasskey({ name }),
    onPendingChange: (pending) => (pending ? onStart?.() : onSettled?.()),
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
      idle: () => undefined,
      pending: () => undefined,
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
        {pending && (
          <LoadingIndicator
            size="inline"
            tone={{ color: theme.colors.accent }}
          />
        )}
        <Text style={styles.label}>{m.passkey_add({}, { locale })}</Text>
      </Pressable>
      {/* Kept mounted so assistive tech announces each change. */}
      <LiveMessage role="status" message={status} />
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
});
