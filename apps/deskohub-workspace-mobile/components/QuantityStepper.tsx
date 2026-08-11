import { Pressable, StyleSheet, Text, View } from "react-native";

import { palette, radii, spacing, type } from "@/constants/Theme";
import { useShop } from "@/src/state/shop-provider";

export function QuantityStepper({
  productName,
  quantity,
  onChange,
  compact = false,
}: {
  productName: string;
  quantity: number;
  onChange: (quantity: number) => void;
  compact?: boolean;
}) {
  const { t } = useShop();
  return (
    <View
      accessibilityLabel={t("quantityFor", {
        product: productName,
        count: quantity,
      })}
      style={[styles.container, compact && styles.containerCompact]}
    >
      <Pressable
        accessibilityLabel={t("decreaseQuantity", { product: productName })}
        accessibilityRole="button"
        disabled={quantity === 0}
        hitSlop={4}
        onPress={() => onChange(quantity - 1)}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          quantity === 0 && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>−</Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={styles.quantity}>
        {quantity}
      </Text>
      <Pressable
        accessibilityLabel={t("increaseQuantity", { product: productName })}
        accessibilityRole="button"
        disabled={quantity >= 10}
        hitSlop={4}
        onPress={() => onChange(quantity + 1)}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          quantity >= 10 && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: palette.surfaceMuted,
    borderRadius: radii.full,
    flexDirection: "row",
    gap: spacing.xxs,
  },
  containerCompact: { alignSelf: "flex-start" },
  button: {
    alignItems: "center",
    borderRadius: radii.full,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  buttonText: {
    color: palette.navy,
    fontSize: 24,
    fontWeight: "600",
    lineHeight: 28,
  },
  quantity: {
    ...type.bodyStrong,
    color: palette.navy,
    minWidth: 24,
    textAlign: "center",
  },
  pressed: { backgroundColor: palette.silver },
  disabled: { opacity: 0.35 },
});
