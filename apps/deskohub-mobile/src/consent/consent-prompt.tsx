import { Pressable, StyleSheet, View } from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { theme } from "../theme";
import { Text } from "../ui/text";

/**
 * Asks once for analytics consent. Both answers carry the same weight, like
 * the site's banner.
 */
export function ConsentPrompt({
  onAccept,
  onDecline,
}: {
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}) {
  const locale = useAppLocale();

  return (
    <View style={styles.prompt}>
      <Text style={styles.message}>
        {m.consent_prompt_message({}, { locale })}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onDecline}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>
            {m.consent_prompt_decline({}, { locale })}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onAccept}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>
            {m.consent_prompt_accept({}, { locale })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  prompt: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.textMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    bottom: theme.spacing.lg,
    gap: theme.spacing.md,
    left: theme.spacing.md,
    padding: theme.spacing.md,
    position: "absolute",
    right: theme.spacing.md,
  },
  message: { color: theme.colors.text, ...theme.type.body },
  actions: { flexDirection: "row", gap: theme.spacing.sm },
  button: {
    alignItems: "center",
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  buttonLabel: {
    color: theme.colors.accent,
    textAlign: "center",
    ...theme.type.body,
  },
});
