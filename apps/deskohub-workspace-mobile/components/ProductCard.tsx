import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { palette, radii, spacing, type } from "@/constants/Theme";
import { formatMoney, localizeText } from "@/src/domain/format";
import type { Product } from "@/src/domain/shop";
import { useShop } from "@/src/state/shop-provider";
import { QuantityStepper } from "./QuantityStepper";

const swatches = {
  aqua: "#D8F8EA",
  orange: "#FCE3D7",
  yellow: "#FFF0D1",
  navy: "#E8E8F2",
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

  return (
    <View style={styles.card}>
      <ProductThumbnail product={product} />
      <View style={styles.copy}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.price}>{formatMoney(product.price, locale)}</Text>
      </View>
      {quantity === 0 && (
        <Pressable
          accessibilityLabel={`${t("add")}: ${name}`}
          accessibilityRole="button"
          onPress={() => setProductQuantity(product.id, 1)}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <Text style={styles.addIcon}>+</Text>
        </Pressable>
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

export function ProductThumbnail({
  product,
  size = 60,
}: {
  product: Product;
  size?: number;
}) {
  const swatch = swatches[product.color];
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  return (
    <View
      style={[
        styles.productMark,
        { backgroundColor: swatch, height: size + 16, width: size },
      ]}
    >
      {product.imageUrl && product.imageUrl !== failedImageUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          accessible={false}
          onError={() => setFailedImageUrl(product.imageUrl ?? null)}
          resizeMode="contain"
          source={{ uri: product.imageUrl }}
          style={styles.productImage}
        />
      ) : (
        <Image
          accessibilityIgnoresInvertColors
          accessible={false}
          resizeMode="contain"
          source={require("../assets/images/icon.png")}
          style={styles.placeholderImage}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 100,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  productMark: {
    alignItems: "center",
    borderRadius: radii.sm,
    flexShrink: 0,
    justifyContent: "center",
    overflow: "hidden",
  },
  placeholderImage: { height: "72%", width: "72%" },
  productImage: {
    height: "100%",
    width: "100%",
  },
  copy: {
    flex: 1,
  },
  name: {
    ...type.bodyStrong,
    color: palette.navy,
  },
  price: {
    ...type.bodyStrong,
    color: palette.navy,
    marginTop: spacing.xxs,
  },
  addButton: {
    alignItems: "center",
    backgroundColor: palette.sunset,
    borderRadius: radii.sm,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  addIcon: { color: palette.navy, fontSize: 28, fontWeight: "500" },
  pressed: { opacity: 0.72 },
});
