import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { palette, radii, spacing, type } from "@/constants/Theme";

export function ActionButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "payment" | "secondary" | "text" | "danger";
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const variants = {
    primary: { button: styles.buttonPrimary, text: styles.buttonTextPrimary },
    payment: { button: styles.buttonPayment, text: styles.buttonTextPrimary },
    secondary: {
      button: styles.buttonSecondary,
      text: styles.buttonTextSecondary,
    },
    text: { button: styles.buttonTextOnly, text: styles.buttonTextSecondary },
    danger: { button: styles.buttonDanger, text: styles.buttonTextDanger },
  } as const;
  const selected = variants[variant];

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected.button,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading && (
        <ActivityIndicator
          color={
            variant === "primary" || variant === "payment"
              ? palette.white
              : palette.navy
          }
        />
      )}
      <Text style={[styles.buttonLabel, selected.text]}>{label}</Text>
    </Pressable>
  );
}

export function StatusBanner({
  title,
  body,
  tone = "info",
}: {
  title: string;
  body?: string;
  tone?: "info" | "warning" | "success" | "error";
}) {
  const tones = {
    info: { backgroundColor: palette.infoSurface, color: palette.navy },
    warning: {
      backgroundColor: palette.warningSurface,
      color: palette.orangeInk,
    },
    success: {
      backgroundColor: palette.successSurface,
      color: palette.aquamarineInk,
    },
    error: { backgroundColor: palette.dangerSurface, color: palette.danger },
  } as const;
  const selected = tones[tone];
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: selected.backgroundColor }]}
    >
      <Text style={[styles.bannerTitle, { color: selected.color }]}>
        {title}
      </Text>
      {body && (
        <Text style={[styles.bannerBody, { color: selected.color }]}>
          {body}
        </Text>
      )}
    </View>
  );
}

export function StatePanel({
  title,
  body,
  action,
  mark = "DW",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  mark?: string;
}) {
  return (
    <View style={styles.statePanel}>
      <View style={styles.stateMark}>
        <Text style={styles.stateMarkText}>{mark}</Text>
      </View>
      <Text accessibilityRole="header" style={styles.stateTitle}>
        {title}
      </Text>
      <Text style={styles.stateBody}>{body}</Text>
      {action && <View style={styles.stateAction}>{action}</View>}
    </View>
  );
}

export function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {action}
    </View>
  );
}

export function Pill({
  label,
  selected = false,
}: {
  label: string;
  selected?: boolean;
}) {
  return (
    <View style={[styles.pill, selected && styles.pillSelected]}>
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
        {label}
      </Text>
    </View>
  );
}

const skeletonRowKeys = ["first", "second", "third"] as const;

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" style={styles.skeletonList}>
      {skeletonRowKeys.slice(0, rows).map((key) => (
        <View key={key} style={styles.skeletonRow}>
          <View style={styles.skeletonBlock} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonLine, { width: "62%" }]} />
            <View style={[styles.skeletonLine, { width: "38%" }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  buttonPrimary: {
    backgroundColor: palette.navy,
  },
  buttonPayment: {
    backgroundColor: palette.orange,
  },
  buttonSecondary: {
    backgroundColor: palette.surfaceMuted,
  },
  buttonTextOnly: {
    backgroundColor: "transparent",
  },
  buttonDanger: {
    backgroundColor: palette.dangerSurface,
  },
  buttonLabel: {
    ...type.label,
    textAlign: "center",
  },
  buttonTextPrimary: { color: palette.white },
  buttonTextSecondary: { color: palette.navy },
  buttonTextDanger: { color: palette.danger },
  pressed: { opacity: 0.74 },
  disabled: { opacity: 0.42 },
  banner: {
    borderRadius: radii.md,
    gap: spacing.xxs,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerTitle: { ...type.label },
  bannerBody: { ...type.caption },
  statePanel: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxl,
  },
  stateMark: {
    alignItems: "center",
    backgroundColor: palette.infoSurface,
    borderRadius: radii.full,
    height: 88,
    justifyContent: "center",
    marginBottom: spacing.lg,
    width: 88,
  },
  stateMarkText: {
    color: palette.navy,
    fontSize: 32,
    fontWeight: "800",
  },
  stateTitle: {
    ...type.headline,
    color: palette.navy,
    maxWidth: 540,
    textAlign: "center",
  },
  stateBody: {
    ...type.body,
    color: palette.navyMuted,
    marginTop: spacing.xs,
    maxWidth: 560,
    textAlign: "center",
  },
  stateAction: {
    marginTop: spacing.lg,
    minWidth: 220,
  },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    ...type.title,
    color: palette.navy,
  },
  pill: {
    alignItems: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.sm,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  pillSelected: { backgroundColor: palette.navy, borderColor: palette.navy },
  pillText: { ...type.label, color: palette.navyMuted },
  pillTextSelected: { color: palette.white },
  skeletonList: { gap: spacing.sm },
  skeletonRow: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  skeletonBlock: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: radii.sm,
    height: 64,
    width: 64,
  },
  skeletonCopy: { flex: 1, gap: spacing.sm, justifyContent: "center" },
  skeletonLine: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: radii.full,
    height: 12,
  },
});
