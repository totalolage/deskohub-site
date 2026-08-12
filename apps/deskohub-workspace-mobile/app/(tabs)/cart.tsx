import { router } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppScreen } from "@/components/AppScreen";
import { BackHeader } from "@/components/BackHeader";
import {
  ActionButton,
  LoadingSkeleton,
  StatePanel,
  StatusBanner,
} from "@/components/Controls";
import { ProductThumbnail } from "@/components/ProductCard";
import { SellerDetails } from "@/components/PurchaseComponents";
import { QuantityStepper } from "@/components/QuantityStepper";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { getLocalCartTotal } from "@/src/domain/cart";
import { formatMoney, localizeText } from "@/src/domain/format";
import { useShop } from "@/src/state/shop-provider";

export default function CartScreen() {
  const {
    actionError,
    cart,
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
      footer={
        <SafeAreaView edges={["bottom"]} style={styles.checkoutSafeArea}>
          <View style={styles.checkoutDock}>
            <ActionButton
              disabled={!quote || !isOnline}
              label={t("startPayment")}
              loading={isActionPending && Boolean(quote)}
              onPress={() => void beginPayment()}
              variant="payment"
            />
          </View>
        </SafeAreaView>
      }
      header={false}
      navigationHeader={<BackHeader title={t("cartTitle")} />}
    >
      {actionError && <StatusBanner title={t("errorTitle")} tone="error" />}
      <View style={styles.editLines}>
        {cartProducts.map(({ product, quantity }) => {
          const name = localizeText(product.name, locale);
          return (
            <View key={product.id} style={styles.editLine}>
              <ProductThumbnail product={product} size={54} />
              <View style={styles.editCopy}>
                <Text style={styles.editName}>{name}</Text>
                <Text style={styles.editPrice}>
                  {formatMoney(
                    quote?.lines.find((line) => line.productId === product.id)
                      ?.unitPrice ?? product.price,
                    locale
                  )}
                </Text>
              </View>
              <QuantityStepper
                compact
                productName={name}
                quantity={quantity}
                onChange={(nextQuantity) =>
                  setProductQuantity(product.id, nextQuantity)
                }
              />
            </View>
          );
        })}
      </View>
      <View key={displayedTotal.minorUnits} style={styles.estimate}>
        <Text style={styles.estimateLabel}>
          {quote ? t("confirmedTotal") : t("localEstimate")}
        </Text>
        <Text style={styles.estimateValue}>
          {formatMoney(displayedTotal, locale)}
        </Text>
      </View>
      {isActionPending && !quote && (
        <View style={styles.quoteLoading}>
          <Text style={styles.quoteLoadingText}>{t("quoteRefreshing")}</Text>
          <LoadingSkeleton label={t("loadingTitle")} rows={1} />
        </View>
      )}
      {quote && (
        <View style={styles.confirmed}>
          <SellerDetails seller={quote.seller} />
        </View>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  editLines: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  editLine: {
    alignItems: "center",
    borderBottomColor: palette.surfaceMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 96,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  editCopy: { flex: 1 },
  editName: { ...type.bodyStrong, color: palette.navy },
  editPrice: { ...type.caption, color: palette.navyMuted },
  estimate: {
    alignItems: "center",
    borderBottomColor: palette.outline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.lg,
  },
  estimateLabel: { ...type.label, color: palette.navyMuted },
  estimateValue: { ...type.headline, color: palette.navy },
  quoteLoading: { gap: spacing.sm, marginTop: spacing.md },
  quoteLoadingText: { ...type.caption, color: palette.navyMuted },
  confirmed: { gap: spacing.md, marginTop: spacing.md },
  checkoutSafeArea: { backgroundColor: palette.paper },
  checkoutDock: {
    backgroundColor: palette.paper,
    borderTopColor: palette.outline,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
