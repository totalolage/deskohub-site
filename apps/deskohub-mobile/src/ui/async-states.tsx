import { useEffect } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { theme } from "../theme";
import { Button } from "./controls";

/**
 * Fills the screen while its content first loads. The spinner carries
 * `label` for assistive tech; there is no visible loading copy.
 */
export function LoadingState({ label }: { readonly label: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator
        role="progressbar"
        aria-label={label}
        aria-busy
        size="large"
        color={theme.colors.accent}
      />
    </View>
  );
}

/**
 * Replaces the screen's content when it couldn't load: the message and a
 * retry button, disabled while the retry runs. It appears together with its
 * message, which native screen readers don't announce as a live region, so
 * the message is announced directly there; browsers announce a new alert.
 */
export function ErrorState({
  message,
  retryLabel,
  onRetry,
  retrying = false,
}: {
  readonly message: string;
  readonly retryLabel: string;
  readonly onRetry: () => void;
  readonly retrying?: boolean;
}) {
  useEffect(() => {
    if (Platform.OS !== "web") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);
  return (
    <View style={styles.centered}>
      <Text role="alert" style={styles.message}>
        {message}
      </Text>
      <Button
        variant="secondary"
        label={retryLabel}
        onPress={onRetry}
        disabled={retrying}
      />
    </View>
  );
}

/**
 * A quiet line shown while content already on screen is refreshed in the
 * background. It stays mounted as a status region and shows the spinner and
 * `label` only while `refreshing`.
 */
export function RefreshingIndicator({
  refreshing,
  label,
}: {
  readonly refreshing: boolean;
  readonly label: string;
}) {
  return (
    <View style={styles.refreshing}>
      {refreshing && (
        <ActivityIndicator
          aria-hidden
          size="small"
          color={theme.colors.textMuted}
        />
      )}
      <Text role="status" aria-live="polite" style={styles.refreshingLabel}>
        {refreshing ? label : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: "center",
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: "center",
    minHeight: 200,
    padding: theme.spacing.lg,
  },
  message: {
    color: theme.colors.text,
    maxWidth: 420,
    textAlign: "center",
    ...theme.type.body,
  },
  refreshing: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing.sm,
    justifyContent: "center",
  },
  refreshingLabel: { color: theme.colors.textMuted, ...theme.type.caption },
});
