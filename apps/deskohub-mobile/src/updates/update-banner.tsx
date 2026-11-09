import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAnalyticsConsent } from "../consent/use-analytics-consent";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { theme } from "../theme";
import { Text } from "../ui/text";
import { updatePromptWaitsForConsent } from "./update-prompt";
import { useUpdatePrompt } from "./use-update-prompt";

/**
 * The update offer, laid over the bottom of every screen without blocking
 * it. The live region stays mounted so screen readers announce a prompt
 * when it appears. It stays empty while the analytics consent prompt, which
 * sits in the same place, waits for an answer.
 */
export function UpdateBanner() {
  const locale = useAppLocale();
  const insets = useSafeAreaInsets();
  const { prompt: offered, accept, dismiss } = useUpdatePrompt();
  const consent = useAnalyticsConsent();
  const prompt = updatePromptWaitsForConsent(consent.status)
    ? undefined
    : offered;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.overlay,
        {
          paddingBottom: insets.bottom + theme.spacing.md,
          paddingLeft: insets.left + theme.spacing.md,
          paddingRight: insets.right + theme.spacing.md,
        },
      ]}
    >
      {prompt?.kind === "native-release" && (
        <UpdateBannerCard
          acceptLabel={m.native_update_download({}, { locale })}
          dismissLabel={m.update_prompt_dismiss({}, { locale })}
          message={m.native_update_available(
            { versionName: prompt.versionName },
            { locale }
          )}
          onAccept={accept}
          onDismiss={dismiss}
        />
      )}
      {(prompt?.kind === "ota-update" || prompt?.kind === "roll-back") && (
        <UpdateBannerCard
          acceptLabel={m.update_ready_restart({}, { locale })}
          dismissLabel={m.update_prompt_dismiss({}, { locale })}
          message={m.update_ready({}, { locale })}
          onAccept={accept}
          onDismiss={dismiss}
        />
      )}
    </View>
  );
}

function UpdateBannerCard({
  message,
  acceptLabel,
  dismissLabel,
  onAccept,
  onDismiss,
}: {
  readonly message: string;
  readonly acceptLabel: string;
  readonly dismissLabel: string;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.action}
        >
          <Text style={styles.dismissLabel}>{dismissLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onAccept}
          style={[styles.action, styles.acceptAction]}
        >
          <Text style={styles.acceptLabel}>{acceptLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    bottom: 0,
    left: 0,
    pointerEvents: "box-none",
    position: "absolute",
    right: 0,
  },
  card: {
    backgroundColor: theme.colors.text,
    borderRadius: theme.radius.md,
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  message: { color: theme.colors.background, ...theme.type.body },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    justifyContent: "flex-end",
  },
  action: {
    borderRadius: theme.radius.md,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
  },
  acceptAction: { backgroundColor: theme.colors.accent },
  dismissLabel: { color: theme.colors.background, ...theme.type.body },
  acceptLabel: { color: theme.colors.background, ...theme.type.bodyStrong },
});
