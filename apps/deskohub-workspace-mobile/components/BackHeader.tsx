import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { palette, radii, spacing, type } from "@/constants/Theme";
import { useShop } from "@/src/state/shop-provider";

export function BackHeader({ title }: { title?: string }) {
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
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      {title && (
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    backgroundColor: palette.navy,
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  back: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: radii.full,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  backText: {
    ...type.headline,
    color: palette.white,
    lineHeight: 30,
    marginTop: -2,
  },
  title: {
    ...type.title,
    color: palette.white,
    flex: 1,
    flexShrink: 1,
    marginLeft: spacing.xs,
    paddingRight: spacing.md,
  },
  pressed: { opacity: 0.7 },
});
