import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { palette, radii, spacing, type } from "@/constants/Theme";
import { AppIcon } from "./AppIcon";

export function SignInHandoff({
  title,
  body,
  actionLabel,
  onContinue,
  loading = false,
  notice,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onContinue: () => void;
  loading?: boolean;
  notice?: ReactNode;
}) {
  return (
    <View style={styles.shell}>
      <View style={styles.brandMark}>
        <AppIcon
          color={palette.white}
          name={{ ios: "storefront", android: "storefront", web: "storefront" }}
          size={28}
        />
      </View>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <View style={styles.actions}>
        {notice}
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={onContinue}
          style={({ pressed }) => [
            styles.action,
            pressed && styles.pressed,
            loading && styles.disabled,
          ]}
        >
          {loading && <ActivityIndicator color={palette.white} size="small" />}
          <Text style={styles.actionLabel}>{actionLabel}</Text>
          {!loading && (
            <AppIcon
              color={palette.white}
              name={{
                ios: "arrow.right",
                android: "arrow_forward",
                web: "arrow_forward",
              }}
              size={16}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignSelf: "center",
    flex: 1,
    justifyContent: "center",
    maxWidth: 448,
    paddingVertical: spacing.xxl,
    width: "100%",
  },
  brandMark: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: palette.action,
    borderRadius: radii.md,
    height: 48,
    justifyContent: "center",
    marginBottom: spacing.lg,
    width: 48,
  },
  copy: { alignItems: "center", gap: spacing.xs },
  title: { ...type.display, color: palette.ink, textAlign: "center" },
  body: {
    ...type.body,
    color: palette.secondaryInk,
    maxWidth: 420,
    textAlign: "center",
  },
  actions: { gap: spacing.sm, marginTop: spacing.xxl },
  action: {
    alignItems: "center",
    backgroundColor: palette.action,
    borderRadius: 4,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  actionLabel: {
    ...type.caption,
    color: palette.white,
    fontWeight: "700",
    letterSpacing: 0.6,
    textAlign: "center",
  },
  pressed: { opacity: 0.74 },
  disabled: { opacity: 0.42 },
});
