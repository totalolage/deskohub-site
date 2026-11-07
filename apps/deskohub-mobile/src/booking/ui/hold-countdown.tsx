import type { CustomerLocale } from "@deskohub/workspace-customer-api";
import { StyleSheet, Text, View } from "react-native";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { holdSecondsLeft } from "../checkout-screen/review-view";

/** The last minute is shown as a warning. */
const warningSeconds = 60;

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * How long the held reservation stays reserved: `expiresAt - now`. The
 * checkout flow owns the clock and expires the hold; this only shows it.
 */
export function HoldCountdown({
  expiresAt,
  now,
  locale,
}: {
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  /** The flow clock's latest tick, epoch milliseconds. */
  readonly now: number;
  readonly locale: CustomerLocale;
}) {
  const seconds = holdSecondsLeft(expiresAt, now);
  const warning = seconds <= warningSeconds;
  return (
    <View
      role="timer"
      style={[styles.container, warning && styles.warningContainer]}
    >
      <Text style={styles.label}>
        {m.booking_checkout_hold_label({}, { locale })}
      </Text>
      <Text style={[styles.time, warning && styles.warningTime]}>
        {clock(seconds)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  warningContainer: { borderColor: theme.colors.warning },
  label: { ...theme.type.caption, flex: 1, color: theme.colors.textMuted },
  time: {
    ...theme.type.heading,
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
  },
  warningTime: { color: theme.colors.warning },
});
