import { SymbolView } from "expo-symbols";
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
        <View style={styles.cartIcon}>
          <SymbolView
            name={{
              ios: "basket",
              android: "shopping_basket",
              web: "shopping_basket",
            }}
            size={27}
            tintColor={palette.white}
          />
          <View style={styles.count}>
            <Text style={styles.countText}>{cartQuantity}</Text>
          </View>
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{t("cartView")}</Text>
        </View>
        <Text style={styles.total}>
          {formatMoney({ currency: "CZK", minorUnits: total }, locale)}
        </Text>
        <Text aria-hidden style={styles.chevron}>
          ›
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
    ...elevation.floating,
    alignItems: "center",
    backgroundColor: palette.navy,
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  cartIcon: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    position: "relative",
    width: 44,
  },
  count: {
    alignItems: "center",
    backgroundColor: palette.aquamarine,
    borderRadius: radii.full,
    height: 22,
    justifyContent: "center",
    minWidth: 22,
    paddingHorizontal: 5,
    position: "absolute",
    right: -2,
    top: 0,
  },
  countText: { color: palette.navy, fontSize: 11, fontWeight: "800" },
  copy: { flex: 1 },
  title: { ...type.label, color: palette.white },
  total: { ...type.bodyStrong, color: palette.white },
  chevron: { color: palette.white, fontSize: 28, marginLeft: spacing.xxs },
  pressed: { opacity: 0.82 },
});
