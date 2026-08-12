import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { useShop } from "@/src/state/shop-provider";

export function BackHeader({
  title,
  trailingShopIcon = false,
}: {
  title?: string;
  trailingShopIcon?: boolean;
}) {
  const { t } = useShop();
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel={t("back")}
        accessibilityRole="button"
        hitSlop={4}
        onPress={() => router.back()}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <AppIcon
          color={palette.action}
          name={{
            ios: "chevron.left",
            android: "arrow_back",
            web: "arrow_back",
          }}
          size={20}
        />
      </Pressable>
      {title && (
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      )}
      {trailingShopIcon && (
        <AppIcon
          color={palette.action}
          name={{ ios: "storefront", android: "storefront", web: "storefront" }}
          size={20}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    backgroundColor: palette.surfaceMuted,
    borderBottomColor: palette.outline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  back: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: radii.sm,
    height: 44,
    justifyContent: "center",
    width: 24,
  },
  title: {
    ...type.title,
    color: palette.action,
    flex: 1,
    flexShrink: 1,
    marginLeft: spacing.xs,
    paddingRight: spacing.md,
  },
  pressed: { opacity: 0.7 },
});
