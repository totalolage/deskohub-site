import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppScreen, ScreenIntro } from "@/components/AppScreen";
import { BackHeader } from "@/components/BackHeader";
import { ActionButton, StatePanel, StatusBanner } from "@/components/Controls";
import { PurchaseStatusBadge } from "@/components/PurchaseComponents";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { formatMoney } from "@/src/domain/format";
import { useShop } from "@/src/state/shop-provider";

export default function PaymentScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const {
    actionError,
    apiMode,
    completePaymentHandoff,
    isActionPending,
    isOnline,
    loadPurchase,
    locale,
    paymentHandoff,
    paymentPurchase,
    purchases,
    refreshPurchase,
    t,
  } = useShop();
  const normalizedOrderId = Array.isArray(orderId) ? orderId[0] : orderId;
  const purchase =
    paymentPurchase?.id === normalizedOrderId
      ? paymentPurchase
      : (purchases.find((candidate) => candidate.id === normalizedOrderId) ??
        null);

  useEffect(() => {
    if (normalizedOrderId && !purchase && !isActionPending && !actionError)
      void loadPurchase(normalizedOrderId);
  }, [actionError, isActionPending, loadPurchase, normalizedOrderId, purchase]);

  if (!normalizedOrderId) {
    return (
      <AppScreen header={false}>
        <BackHeader />
        <StatePanel body={t("errorBody")} mark="!" title={t("errorTitle")} />
      </AppScreen>
    );
  }

  const check = () => {
    if (paymentHandoff?.orderId === normalizedOrderId)
      return completePaymentHandoff();
    return refreshPurchase(normalizedOrderId);
  };
  const paymentActionLabel = (() => {
    if (isActionPending) return t("checkingPayment");
    if (paymentHandoff?.orderId !== normalizedOrderId) return t("checkPayment");
    return apiMode === "demo" ? t("demoPayment") : t("openPayment");
  })();

  if (purchase?.status === "paid") {
    return (
      <AppScreen header={false}>
        <BackHeader />
        <StatePanel
          action={
            <View style={styles.actions}>
              <ActionButton
                label={t("viewPurchase")}
                onPress={() =>
                  router.replace(
                    `/purchase/${encodeURIComponent(normalizedOrderId)}`
                  )
                }
              />
              <ActionButton
                label={t("returnToShop")}
                onPress={() => router.replace("/")}
                variant="secondary"
              />
            </View>
          }
          body={t("paymentPaidBody")}
          mark="✓"
          title={t("paymentPaidTitle")}
        />
      </AppScreen>
    );
  }

  if (
    purchase?.status === "failed" ||
    purchase?.status === "cancelled" ||
    purchase?.status === "expired"
  ) {
    return (
      <AppScreen header={false}>
        <BackHeader />
        <StatePanel
          action={
            <ActionButton
              label={t("backToShop")}
              onPress={() => router.replace("/cart")}
            />
          }
          body={t("paymentFailedBody")}
          mark="×"
          title={t("paymentFailedTitle")}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen header={false}>
      <BackHeader />
      <ScreenIntro
        kicker={t("paymentKicker")}
        title={t("paymentReadyTitle")}
        body={t("paymentReadyBody")}
      />
      {actionError && (
        <StatusBanner
          body={t("errorBody")}
          title={t("errorTitle")}
          tone="error"
        />
      )}
      <View style={styles.paymentCard}>
        <View style={styles.paymentTopline}>
          <Text style={styles.orderId}>
            {t("orderNumber", { id: normalizedOrderId })}
          </Text>
          <PurchaseStatusBadge status={purchase?.status ?? "payment_pending"} />
        </View>
        {purchase && (
          <Text style={styles.amount}>
            {formatMoney(purchase.total, locale)}
          </Text>
        )}
        <Text style={styles.paymentHint}>
          {purchase ? t("paymentPendingBody") : t("paymentReadyBody")}
        </Text>
      </View>
      {!isOnline && (
        <StatusBanner title={t("paymentOnlineOnly")} tone="warning" />
      )}
      <ActionButton
        disabled={!isOnline}
        label={paymentActionLabel}
        loading={isActionPending}
        onPress={() => void check()}
        style={styles.primaryAction}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  paymentCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  paymentTopline: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  orderId: { ...type.bodyStrong, color: palette.navy },
  amount: { ...type.display, color: palette.navy, marginTop: spacing.md },
  paymentHint: { ...type.body, color: palette.navyMuted },
  primaryAction: { marginTop: spacing.md },
  actions: { gap: spacing.sm },
});
