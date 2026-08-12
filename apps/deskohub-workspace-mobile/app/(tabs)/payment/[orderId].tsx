import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeInUp,
  ReduceMotion,
  ZoomIn,
} from "react-native-reanimated";

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
    if (normalizedOrderId && !purchase) void loadPurchase(normalizedOrderId);
  }, [loadPurchase, normalizedOrderId, purchase]);

  if (!normalizedOrderId) {
    return (
      <AppScreen
        header={false}
        navigationHeader={<BackHeader title={t("paymentKicker")} />}
      >
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
      <AppScreen
        header={false}
        navigationHeader={<BackHeader title={t("paymentKicker")} />}
      >
        <Animated.View
          entering={FadeInUp.duration(220).reduceMotion(ReduceMotion.System)}
          style={styles.paidHero}
        >
          <Animated.View
            entering={ZoomIn.duration(260).reduceMotion(ReduceMotion.System)}
            style={styles.paidMark}
          >
            <Text style={styles.paidMarkText}>✓</Text>
          </Animated.View>
          <Text accessibilityRole="header" style={styles.paidTitle}>
            {t("paymentPaidTitle")}
          </Text>
          <Text style={styles.paidAmount}>
            {formatMoney(purchase.total, locale)}
          </Text>
          <Text style={styles.paidBody}>{t("paymentPaidBody")}</Text>
        </Animated.View>
        <View style={styles.paidSummary}>
          <Text style={styles.summaryLabel}>
            {t("orderNumber", { id: purchase.publicReference })}
          </Text>
          <Text style={styles.summarySeller}>{purchase.seller.legalName}</Text>
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
    <AppScreen
      header={false}
      navigationHeader={<BackHeader title={t("paymentKicker")} />}
    >
      <ScreenIntro
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
  paymentHint: { ...type.body, color: palette.navyMuted },
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
  paidMarkText: { color: palette.white, fontSize: 52, fontWeight: "700" },
  paidTitle: { ...type.display, color: palette.navy, textAlign: "center" },
  paidAmount: {
    ...type.headline,
    color: palette.navy,
    marginTop: spacing.sm,
  },
  paidBody: {
    ...type.body,
    color: palette.navyMuted,
    marginTop: spacing.sm,
    maxWidth: 520,
    textAlign: "center",
  },
  paidSummary: {
    alignSelf: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    marginBottom: spacing.lg,
    maxWidth: 560,
    padding: spacing.md,
    width: "100%",
  },
  summaryLabel: { ...type.label, color: palette.navy },
  summarySeller: { ...type.caption, color: palette.navyMuted },
});
