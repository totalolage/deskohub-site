import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { formatMoney, localizeText } from "@/src/domain/format";
import type { Product } from "@/src/domain/shop";
import { useShop } from "@/src/state/shop-provider";
import { QuantityStepper } from "./QuantityStepper";

export function ProductCard({
  product,
  quantity,
}: {
  product: Product;
  quantity: number;
}) {
  const { locale, setProductQuantity, t } = useShop();
  const name = localizeText(product.name, locale);
  const description = localizeText(product.description, locale);

  return (
    <View style={styles.card}>
      <ProductThumbnail product={product} />
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.name}>
          {name}
        </Text>
        {description && (
          <Text numberOfLines={1} style={styles.description}>
            {description}
          </Text>
        )}
      </View>
      <View style={styles.purchaseColumn}>
        <Text style={styles.price}>{formatMoney(product.price, locale)}</Text>
        {quantity === 0 && (
          <Pressable
            accessibilityLabel={`${t("add")}: ${name}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setProductQuantity(product.id, 1)}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.pressed,
            ]}
          >
            <AppIcon
              color={palette.white}
              name={{ ios: "plus", android: "add", web: "add" }}
              size={14}
            />
            <Text style={styles.addLabel}>{t("add")}</Text>
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
    </View>
  );
}

export function ProductThumbnail({
  product,
  size = 48,
}: {
  product: Product;
  size?: number;
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  return (
    <View style={[styles.productMark, { height: size, width: size }]}>
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
    borderBottomColor: palette.outline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 86,
    padding: spacing.md,
  },
  productMark: {
    alignItems: "center",
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.disabledInk,
    borderRadius: radii.sm,
    borderWidth: 1,
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
    gap: spacing.xxs,
    minWidth: 0,
  },
  name: {
    ...type.caption,
    color: palette.ink,
    fontWeight: "600",
  },
  description: { ...type.label, color: palette.secondaryInk },
  price: {
    ...type.label,
    color: palette.ink,
    fontWeight: "700",
    textAlign: "right",
  },
  purchaseColumn: {
    alignItems: "flex-end",
    alignSelf: "stretch",
    justifyContent: "center",
    minWidth: 76,
  },
  addButton: {
    alignItems: "center",
    backgroundColor: palette.action,
    borderRadius: 4,
    flexDirection: "row",
    gap: spacing.xxs,
    height: 28,
    justifyContent: "center",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  addLabel: { ...type.label, color: palette.white },
  pressed: { opacity: 0.72 },
});
