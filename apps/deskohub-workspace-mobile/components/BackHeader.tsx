import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { palette, radii, spacing, type } from "@/constants/Theme";
import { useShop } from "@/src/state/shop-provider";
import { Brand } from "./Brand";

export function BackHeader() {
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
      <Brand compact />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  back: {
    alignItems: "center",
    backgroundColor: palette.surfaceMuted,
    borderRadius: radii.full,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  backText: {
    ...type.headline,
    color: palette.navy,
    lineHeight: 30,
    marginTop: -2,
  },
  pressed: { opacity: 0.7 },
});
