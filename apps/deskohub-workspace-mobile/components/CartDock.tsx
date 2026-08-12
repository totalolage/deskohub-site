import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { getLocalCartTotal } from "@/src/domain/cart";
import { formatMoney } from "@/src/domain/format";
import { useShop } from "@/src/state/shop-provider";

export function CartDock({ onPress }: { onPress: () => void }) {
  const { cart, cartQuantity, catalog, locale, t } = useShop();
  if (cartQuantity === 0 || !catalog) return null;
  const total = getLocalCartTotal(cart, catalog.products);

  return (
    <View style={styles.wrap}>
      <View style={styles.summary}>
        <Text style={styles.title}>
          {t("confirmedTotal")} ·{" "}
          {cartQuantity === 1
            ? t("cartItem")
            : t("cartItems", { count: cartQuantity })}
        </Text>
        <Text style={styles.total}>
          {formatMoney({ currency: "CZK", minorUnits: total }, locale)}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={`${t("cartView")}, ${cartQuantity === 1 ? t("cartItem") : t("cartItems", { count: cartQuantity })}`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.checkout, pressed && styles.pressed]}
      >
        <Text style={styles.checkoutLabel}>{t("cartView")}</Text>
        <AppIcon
          color={palette.white}
          name={{
            ios: "chevron.right",
            android: "chevron_right",
            web: "chevron_right",
          }}
          size={18}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    backgroundColor: palette.canvas,
    borderTopColor: palette.outline,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  summary: { flex: 1 },
  checkout: {
    alignItems: "center",
    backgroundColor: palette.action,
    borderRadius: radii.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  title: { ...type.caption, color: palette.secondaryInk },
  total: { ...type.title, color: palette.ink },
  checkoutLabel: { ...type.caption, color: palette.white, fontWeight: "700" },
  pressed: { opacity: 0.82 },
});
