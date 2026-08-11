import { Pressable, StyleSheet, Text, View } from "react-native";

import { elevation, palette, radii, spacing, type } from "@/constants/Theme";
import { getLocalCartTotal } from "@/src/domain/cart";
import { formatMoney } from "@/src/domain/format";
import { useShop } from "@/src/state/shop-provider";

export function CartDock({ onPress }: { onPress: () => void }) {
  const { cart, cartQuantity, catalog, locale, t } = useShop();
  if (cartQuantity === 0 || !catalog) return null;
  const total = getLocalCartTotal(cart, catalog.products);

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityLabel={`${t("cartView")}, ${cartQuantity === 1 ? t("cartItem") : t("cartItems", { count: cartQuantity })}`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.dock, pressed && styles.pressed]}
      >
        <View style={styles.count}>
          <Text style={styles.countText}>{cartQuantity}</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{t("cartView")}</Text>
          <Text style={styles.subtitle}>
            {cartQuantity === 1
              ? t("cartItem")
              : t("cartItems", { count: cartQuantity })}
          </Text>
        </View>
        <Text style={styles.total}>
          {formatMoney({ currency: "CZK", minorUnits: total }, locale)}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: palette.paper,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dock: {
    ...elevation.card,
    alignItems: "center",
    backgroundColor: palette.navy,
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  count: {
    alignItems: "center",
    backgroundColor: palette.aquamarine,
    borderRadius: radii.full,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  countText: { ...type.label, color: palette.navy },
  copy: { flex: 1 },
  title: { ...type.label, color: palette.white },
  subtitle: { ...type.caption, color: "#D7D7E5" },
  total: { ...type.bodyStrong, color: palette.white },
  pressed: { opacity: 0.82 },
});
