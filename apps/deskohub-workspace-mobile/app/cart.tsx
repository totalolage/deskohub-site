import { router } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppScreen, ScreenIntro } from "@/components/AppScreen";
import { BackHeader } from "@/components/BackHeader";
import {
  ActionButton,
  LoadingSkeleton,
  StatePanel,
  StatusBanner,
} from "@/components/Controls";
import { OrderLines, SellerDetails } from "@/components/PurchaseComponents";
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
      <AppScreen header={false}>
        <BackHeader />
        <StatePanel
          action={
            <ActionButton
              label={t("backToShop")}
              onPress={() => router.replace("/")}
            />
          }
          body={t("cartEmptyBody")}
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

  return (
    <AppScreen header={false}>
      <BackHeader />
      <ScreenIntro
        kicker={t("reviewKicker")}
        title={t("reviewTitle")}
        body={t("reviewBody")}
      />
      {actionError && (
        <StatusBanner
          body={t("errorBody")}
          title={t("errorTitle")}
          tone="error"
        />
      )}
      <View style={styles.editLines}>
        {cartProducts.map(({ product, quantity }) => {
          const name = localizeText(product.name, locale);
          return (
            <View key={product.id} style={styles.editLine}>
              <View style={styles.editCopy}>
                <Text style={styles.editName}>{name}</Text>
                <Text style={styles.editPrice}>
                  {formatMoney(product.price, locale)}
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
      <View style={styles.estimate}>
        <Text style={styles.estimateLabel}>{t("localEstimate")}</Text>
        <Text style={styles.estimateValue}>
          {formatMoney({ currency: "CZK", minorUnits: localTotal }, locale)}
        </Text>
      </View>
      {isActionPending && !quote && (
        <View style={styles.quoteLoading}>
          <Text style={styles.quoteLoadingText}>{t("quoteRefreshing")}</Text>
          <LoadingSkeleton rows={1} />
        </View>
      )}
      {quote && (
        <View style={styles.confirmed}>
          <OrderLines lines={quote.lines} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t("confirmedTotal")}</Text>
            <Text style={styles.totalValue}>
              {formatMoney(quote.total, locale)}
            </Text>
          </View>
          <SellerDetails seller={quote.seller} />
        </View>
      )}
      {!isOnline && (
        <StatusBanner title={t("paymentOnlineOnly")} tone="warning" />
      )}
      <ActionButton
        disabled={!quote || !isOnline}
        label={isActionPending ? t("startingPayment") : t("startPayment")}
        loading={isActionPending && Boolean(quote)}
        onPress={() => void beginPayment()}
        style={styles.payButton}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  editLines: {
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  editLine: {
    alignItems: "center",
    borderBottomColor: palette.surfaceMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 80,
    padding: spacing.md,
  },
  editCopy: { flex: 1 },
  editName: { ...type.bodyStrong, color: palette.navy },
  editPrice: { ...type.caption, color: palette.navyMuted },
  estimate: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
  },
  estimateLabel: { ...type.label, color: palette.navyMuted },
  estimateValue: { ...type.bodyStrong, color: palette.navy },
  quoteLoading: { gap: spacing.sm, marginTop: spacing.md },
  quoteLoadingText: { ...type.caption, color: palette.navyMuted },
  confirmed: { gap: spacing.md, marginTop: spacing.md },
  totalRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  totalLabel: { ...type.title, color: palette.navy },
  totalValue: { ...type.headline, color: palette.navy },
  payButton: { marginTop: spacing.lg },
});
