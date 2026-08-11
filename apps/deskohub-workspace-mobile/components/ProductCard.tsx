import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { elevation, palette, radii, spacing, type } from "@/constants/Theme";
import { formatMoney, localizeText } from "@/src/domain/format";
import type { Product } from "@/src/domain/shop";
import { useShop } from "@/src/state/shop-provider";
import { ActionButton } from "./Controls";
import { QuantityStepper } from "./QuantityStepper";

const swatches = {
  aqua: { background: "#D8F8EA", foreground: palette.aquamarineInk },
  orange: { background: "#FCE3D7", foreground: palette.orangeInk },
  yellow: { background: "#FFF0D1", foreground: palette.orangeInk },
  navy: { background: "#E8E8F2", foreground: palette.navy },
} as const;

export function ProductCard({
  product,
  quantity,
}: {
  product: Product;
  quantity: number;
}) {
  const { locale, setProductQuantity, t } = useShop();
  const name = localizeText(product.name, locale);
  const swatch = swatches[product.color];
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  return (
    <View style={styles.card}>
      <View
        style={[styles.productMark, { backgroundColor: swatch.background }]}
      >
        {product.imageUrl && product.imageUrl !== failedImageUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            accessible={false}
            onError={() => setFailedImageUrl(product.imageUrl ?? null)}
            resizeMode="cover"
            source={{ uri: product.imageUrl }}
            style={styles.productImage}
          />
        ) : (
          <Text style={[styles.productInitials, { color: swatch.foreground }]}>
            {product.initials}
          </Text>
        )}
      </View>
      <View style={styles.copy}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.description}>
          {localizeText(product.description, locale)}
        </Text>
        <Text style={styles.price}>{formatMoney(product.price, locale)}</Text>
      </View>
      {quantity === 0 && (
        <ActionButton
          label={t("add")}
          onPress={() => setProductQuantity(product.id, 1)}
          style={styles.addButton}
          variant="secondary"
        />
      )}
      {quantity > 0 && (
        <QuantityStepper
          compact
          productName={name}
          quantity={quantity}
          onChange={(nextQuantity) =>
            setProductQuantity(product.id, nextQuantity)
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...elevation.card,
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    gap: spacing.md,
    minHeight: 220,
    padding: spacing.md,
  },
  productMark: {
    alignItems: "center",
    alignSelf: "stretch",
    borderRadius: radii.sm,
    height: 76,
    justifyContent: "center",
    overflow: "hidden",
  },
  productInitials: {
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  productImage: {
    height: "100%",
    width: "100%",
  },
  copy: {
    flex: 1,
  },
  name: {
    ...type.title,
    color: palette.navy,
  },
  description: {
    ...type.caption,
    color: palette.navyMuted,
    marginTop: spacing.xxs,
  },
  price: {
    ...type.bodyStrong,
    color: palette.navy,
    marginTop: spacing.sm,
  },
  addButton: {
    minHeight: 48,
  },
});
