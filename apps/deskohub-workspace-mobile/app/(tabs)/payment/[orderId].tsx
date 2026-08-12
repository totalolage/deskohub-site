import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { AppScreen } from "@/components/AppScreen";
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
      <AppScreen contentStyle={styles.content}>
        <StatePanel mark="!" title={t("errorTitle")} />
      </AppScreen>
    );
  }

  const check = () => {
    if (paymentHandoff?.orderId === normalizedOrderId)
      return completePaymentHandoff();
    return refreshPurchase(normalizedOrderId);
  };
  const paymentActionLabel =
    paymentHandoff?.orderId === normalizedOrderId
      ? t("openPayment")
      : t("checkPayment");
  const reference = getPurchaseReference(purchase, normalizedOrderId);

  if (purchase?.status === "paid") {
    return (
      <AppScreen contentStyle={styles.content}>
        <View style={styles.statusCard}>
          <View style={[styles.statusMark, styles.successMark]}>
            <AppIcon
              color={palette.positiveInk}
              name={{ ios: "checkmark", android: "check", web: "check" }}
              size={30}
            />
          </View>
          <Text accessibilityRole="header" style={styles.statusTitle}>
            {t("paymentPaidTitle")}
          </Text>
          <View style={styles.statusCopy}>
            <Text style={styles.orderReference}>
              {t("orderNumber", { id: reference })}
            </Text>
            <Text style={styles.statusBody}>{t("receiptSentGeneric")}</Text>
          </View>
          <View style={styles.amountPanel}>
            <Text style={styles.amountLabel}>{t("confirmedTotal")}</Text>
            <Text style={styles.amount}>
              {formatMoney(purchase.total, locale)}
            </Text>
          </View>
          <View style={styles.actions}>
            <ActionButton
              label={t("viewPurchase")}
              onPress={() =>
                router.replace(
                  `/purchase/${encodeURIComponent(normalizedOrderId)}`
                )
              }
              variant="payment"
            />
            <ActionButton
              label={t("returnToShop")}
              onPress={() => router.replace("/")}
              style={styles.secondaryAction}
              variant="secondary"
            />
          </View>
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
      <AppScreen contentStyle={styles.content}>
        <View style={styles.statusCard}>
          <View style={[styles.statusMark, styles.failedMark]}>
            <AppIcon
              color={palette.danger}
              name={{ ios: "xmark", android: "close", web: "close" }}
              size={30}
            />
          </View>
          <Text accessibilityRole="header" style={styles.statusTitle}>
            {t("paymentFailedTitle")}
          </Text>
          <Text style={styles.orderReference}>
            {t("orderNumber", { id: reference })}
          </Text>
          <PurchaseStatusBadge status={purchase.status} />
          <View style={styles.amountPanel}>
            <Text style={styles.amountLabel}>{t("confirmedTotal")}</Text>
            <Text style={styles.amount}>
              {formatMoney(purchase.total, locale)}
            </Text>
          </View>
          <View style={styles.actions}>
            <ActionButton
              label={t("returnToCart")}
              onPress={() => router.replace("/cart")}
              variant="payment"
            />
          </View>
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen contentStyle={styles.content}>
      <View style={styles.statusCard}>
        <View style={[styles.statusMark, styles.pendingMark]}>
          <AppIcon
            color={palette.action}
            name={{ ios: "clock", android: "schedule", web: "schedule" }}
            size={30}
          />
        </View>
        <Text accessibilityRole="header" style={styles.statusTitle}>
          {t("paymentPending")}
        </Text>
        <Text style={styles.orderReference}>
          {t("orderNumber", { id: reference })}
        </Text>
        {actionError && (
          <View style={styles.banner}>
            <StatusBanner title={t("errorTitle")} tone="error" />
          </View>
        )}
        {purchase && (
          <View style={styles.amountPanel}>
            <Text style={styles.amountLabel}>{t("confirmedTotal")}</Text>
            <Text style={styles.amount}>
              {formatMoney(purchase.total, locale)}
            </Text>
          </View>
        )}
        <View style={styles.actions}>
          <ActionButton
            disabled={!isOnline}
            label={paymentActionLabel}
            loading={isActionPending}
            onPress={() => void check()}
            variant="payment"
          />
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    justifyContent: "center",
    maxWidth: 448,
    width: "100%",
  },
  statusCard: {
    alignItems: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    width: "100%",
  },
  statusMark: {
    alignItems: "center",
    borderRadius: radii.full,
    height: 80,
    justifyContent: "center",
    marginBottom: spacing.lg,
    width: 80,
  },
  successMark: { backgroundColor: palette.successSurface },
  pendingMark: { backgroundColor: palette.warningSurface },
  failedMark: { backgroundColor: palette.dangerSurface },
  statusTitle: {
    ...type.headline,
    color: palette.ink,
    textAlign: "center",
  },
  statusCopy: { alignItems: "center", marginTop: spacing.xs },
  orderReference: {
    ...type.body,
    color: palette.secondaryInk,
    textAlign: "center",
  },
  statusBody: {
    ...type.body,
    color: palette.secondaryInk,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  amountPanel: {
    alignItems: "center",
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.outline,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    padding: spacing.md,
    width: "100%",
  },
  amountLabel: { ...type.body, color: palette.secondaryInk },
  amount: { ...type.title, color: palette.ink },
  banner: { marginTop: spacing.lg, width: "100%" },
  actions: { gap: spacing.md, marginTop: spacing.xl, width: "100%" },
  secondaryAction: {
    backgroundColor: palette.surface,
    borderColor: palette.secondaryInk,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
