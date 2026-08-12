import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { AppScreen } from "@/components/AppScreen";
import { BackHeader } from "@/components/BackHeader";
import { ActionButton, StatePanel, StatusBanner } from "@/components/Controls";
import { PurchaseStatusBadge } from "@/components/PurchaseComponents";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { formatMoney } from "@/src/domain/format";
import { getPurchaseReference } from "@/src/domain/shop";
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
    if (normalizedOrderId && !purchase) void loadPurchase(normalizedOrderId);
  }, [loadPurchase, normalizedOrderId, purchase]);

  if (!normalizedOrderId) {
    return (
      <AppScreen
        header={false}
        navigationHeader={<BackHeader title={t("paymentKicker")} />}
      >
        <StatePanel mark="!" title={t("errorTitle")} />
      </AppScreen>
    );
  }

  const check = () => {
    if (paymentHandoff?.orderId === normalizedOrderId)
      return completePaymentHandoff();
    return refreshPurchase(normalizedOrderId);
  };
  const paymentActionLabel = (() => {
    if (paymentHandoff?.orderId !== normalizedOrderId) return t("checkPayment");
    return apiMode === "demo" ? t("demoPayment") : t("openPayment");
  })();

  if (purchase?.status === "paid") {
    return (
      <AppScreen
        header={false}
        navigationHeader={<BackHeader title={t("paymentKicker")} />}
      >
        <View style={styles.paidHero}>
          <View style={styles.paidMark}>
            <AppIcon
              color={palette.white}
              name={{ ios: "checkmark", android: "check", web: "check" }}
              size={52}
            />
          </View>
          <Text accessibilityRole="header" style={styles.paidTitle}>
            {t("paymentPaidTitle")}
          </Text>
          <Text style={styles.paidAmount}>
            {formatMoney(purchase.total, locale)}
          </Text>
          <Text style={styles.paidBody}>{t("receiptSentGeneric")}</Text>
        </View>
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
      </AppScreen>
    );
  }

  if (
    purchase?.status === "failed" ||
    purchase?.status === "cancelled" ||
    purchase?.status === "expired"
  ) {
    return (
      <AppScreen
        header={false}
        navigationHeader={<BackHeader title={t("paymentKicker")} />}
      >
        <StatePanel
          action={
            <ActionButton
              label={t("returnToCart")}
              onPress={() => router.replace("/cart")}
            />
          }
          mark="×"
          title={t("paymentFailedTitle")}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      header={false}
      navigationHeader={<BackHeader title={t("paymentKicker")} />}
    >
      {actionError && <StatusBanner title={t("errorTitle")} tone="error" />}
      <View style={styles.paymentCard}>
        <View style={styles.paymentTopline}>
          <Text style={styles.orderId}>
            {t("orderNumber", {
              id: getPurchaseReference(purchase, normalizedOrderId),
            })}
          </Text>
          <PurchaseStatusBadge status={purchase?.status ?? "payment_pending"} />
        </View>
        {purchase && (
          <Text style={styles.amount}>
            {formatMoney(purchase.total, locale)}
          </Text>
        )}
      </View>
      <ActionButton
        disabled={!isOnline}
        label={paymentActionLabel}
        loading={isActionPending}
        onPress={() => void check()}
        style={styles.primaryAction}
        variant="payment"
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  paymentCard: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
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
  primaryAction: { marginTop: spacing.md },
  actions: {
    alignSelf: "center",
    gap: spacing.sm,
    maxWidth: 560,
    width: "100%",
  },
  paidHero: {
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  paidMark: {
    alignItems: "center",
    backgroundColor: palette.success,
    borderRadius: radii.full,
    height: 104,
    justifyContent: "center",
    marginBottom: spacing.lg,
    width: 104,
  },
  paidTitle: { ...type.display, color: palette.navy, textAlign: "center" },
  paidAmount: {
    ...type.headline,
    color: palette.navy,
    marginTop: spacing.sm,
  },
  paidBody: {
    ...type.caption,
    color: palette.navyMuted,
    marginTop: spacing.xs,
  },
});
