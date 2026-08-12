import { router } from "expo-router";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { AppScreen } from "@/components/AppScreen";
import { BackHeader } from "@/components/BackHeader";
import {
  ActionButton,
  LoadingSkeleton,
  StatePanel,
  StatusBanner,
} from "@/components/Controls";
import { ProductThumbnail } from "@/components/ProductCard";
import { QuantityStepper } from "@/components/QuantityStepper";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { getLocalCartTotal } from "@/src/domain/cart";
import { formatMoney, localizeText } from "@/src/domain/format";
import { useShop } from "@/src/state/shop-provider";

export default function CartScreen() {
  const {
    actionError,
    cart,
    cartQuantity,
    catalog,
    isActionPending,
    isOnline,
    locale,
    prepareQuote,
    quote,
    setProductQuantity,
    startPayment,
    t,
  } = useShop();

  useEffect(() => {
    if (cart.length > 0 && isOnline) void prepareQuote();
  }, [cart.length, isOnline, prepareQuote]);

  if (cart.length === 0) {
    return (
      <AppScreen
        header={false}
        navigationHeader={<BackHeader title={t("cartTitle")} />}
      >
        <StatePanel
          action={
            <ActionButton
              label={t("backToShop")}
              onPress={() => router.replace("/")}
            />
          }
          mark="0"
          title={t("cartEmptyTitle")}
        />
      </AppScreen>
    );
  }

  const localTotal = getLocalCartTotal(cart, catalog?.products ?? []);
  const cartProducts = cart.flatMap((line) => {
    const product = catalog?.products.find(
      (candidate) => candidate.id === line.productId
    );
    return product ? [{ product, quantity: line.quantity }] : [];
  });

  const beginPayment = async () => {
    const handoff = await startPayment();
    if (handoff) router.push(`/payment/${encodeURIComponent(handoff.orderId)}`);
  };

  const displayedTotal = quote?.total ?? {
    currency: "CZK" as const,
    minorUnits: localTotal,
  };

  return (
    <AppScreen
      contentStyle={styles.content}
      header={false}
      navigationHeader={<BackHeader title={t("cartTitle")} />}
    >
      {actionError && <StatusBanner title={t("errorTitle")} tone="error" />}
      <View style={styles.editLines}>
        {cartProducts.map(({ product, quantity }) => {
          const name = localizeText(product.name, locale);
          const description = localizeText(product.description, locale);
          return (
            <View key={product.id} style={styles.editLine}>
              <ProductThumbnail product={product} size={80} />
              <View style={styles.editCopy}>
                <Text numberOfLines={2} style={styles.editName}>
                  {name}
                </Text>
                {description && (
                  <Text numberOfLines={2} style={styles.editDescription}>
                    {description}
                  </Text>
                )}
                <Text style={styles.editPrice}>
                  {formatMoney(
                    quote?.lines.find((line) => line.productId === product.id)
                      ?.unitPrice ?? product.price,
                    locale
                  )}
                </Text>
              </View>
              <View style={styles.lineActions}>
                <Pressable
                  accessibilityLabel={t("removeItem", { product: name })}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setProductQuantity(product.id, 0)}
                  style={({ pressed }) => [
                    styles.removeButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <AppIcon
                    color={palette.danger}
                    name={{ ios: "trash", android: "delete", web: "delete" }}
                    size={18}
                  />
                </Pressable>
                <QuantityStepper
                  compact
                  productName={name}
                  quantity={quantity}
                  onChange={(nextQuantity) =>
                    setProductQuantity(product.id, nextQuantity)
                  }
                />
              </View>
            </View>
          );
        })}
      </View>
      {isActionPending && !quote && (
        <View style={styles.quoteLoading}>
          <Text style={styles.quoteLoadingText}>{t("quoteRefreshing")}</Text>
          <LoadingSkeleton label={t("loadingTitle")} rows={1} />
        </View>
      )}
      <View style={styles.summaryCard}>
        <View key={displayedTotal.minorUnits} style={styles.estimate}>
          <View>
            <Text style={styles.estimateLabel}>
              {quote ? t("confirmedTotal") : t("localEstimate")}
            </Text>
            <Text style={styles.itemCount}>
              {cartQuantity === 1
                ? t("cartItem")
                : t("cartItems", { count: cartQuantity })}
            </Text>
          </View>
          <Text style={styles.estimateValue}>
            {formatMoney(displayedTotal, locale)}
          </Text>
        </View>
        <ActionButton
          disabled={!quote || !isOnline}
          label={t("startPayment")}
          loading={isActionPending && Boolean(quote)}
          onPress={() => void beginPayment()}
          variant="payment"
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    gap: spacing.lg,
    maxWidth: 896,
    width: "100%",
  },
  editLines: {
    gap: spacing.xs,
  },
  editLine: {
    alignItems: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 138,
    padding: spacing.md,
  },
  editCopy: { flex: 1, minWidth: 0 },
  editName: { ...type.title, color: palette.ink },
  editDescription: {
    ...type.caption,
    color: palette.secondaryInk,
    marginTop: spacing.xxs,
  },
  editPrice: {
    ...type.bodyStrong,
    color: palette.action,
    marginTop: spacing.xxs,
  },
  lineActions: {
    alignItems: "flex-end",
    alignSelf: "stretch",
    justifyContent: "space-between",
  },
  removeButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  pressed: { opacity: 0.65 },
  summaryCard: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  estimate: {
    alignItems: "flex-end",
    borderBottomColor: palette.outline,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.md,
  },
  estimateLabel: { ...type.label, color: palette.secondaryInk },
  itemCount: { ...type.caption, color: palette.secondaryInk },
  estimateValue: { ...type.headline, color: palette.action },
  quoteLoading: { gap: spacing.sm },
  quoteLoadingText: { ...type.caption, color: palette.secondaryInk },
});
