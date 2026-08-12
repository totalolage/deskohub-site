import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { BackHeader } from "@/components/BackHeader";
import { ActionButton, StatePanel, StatusBanner } from "@/components/Controls";
import {
  OrderLines,
  PurchaseStatusBadge,
  SellerDetails,
} from "@/components/PurchaseComponents";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { formatMoney, formatPragueDateTime } from "@/src/domain/format";
import { useShop } from "@/src/state/shop-provider";

export default function PurchaseDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { actionError, loadPurchase, locale, purchases, t } = useShop();
  const normalizedOrderId = Array.isArray(orderId) ? orderId[0] : orderId;
  const purchase =
    purchases.find((candidate) => candidate.id === normalizedOrderId) ?? null;

  useEffect(() => {
    if (normalizedOrderId && !purchase) void loadPurchase(normalizedOrderId);
  }, [loadPurchase, normalizedOrderId, purchase]);

  if (!purchase) {
    return (
      <AppScreen
        contentStyle={styles.content}
        header={false}
        navigationHeader={<BackHeader title={t("appName")} trailingShopIcon />}
      >
        {actionError && <StatePanel mark="!" title={t("errorTitle")} />}
        {!actionError && <StatePanel mark="…" title={t("loadingTitle")} />}
      </AppScreen>
    );
  }

  const itemCount = purchase.lines.reduce(
    (count, line) => count + line.quantity,
    0
  );

  return (
    <AppScreen
      contentStyle={styles.content}
      header={false}
      navigationHeader={<BackHeader title={t("appName")} trailingShopIcon />}
    >
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.orderId}>
            {t("orderNumber", { id: purchase.publicReference })}
          </Text>
          <Text style={styles.purchaseDate}>
            {t("purchasedAt", {
              date: formatPragueDateTime(purchase.createdAt, locale),
            })}
          </Text>
        </View>
        <PurchaseStatusBadge status={purchase.status} />
      </View>

      <View style={styles.receipt}>
        <View style={styles.receiptHeader}>
          <Text accessibilityRole="header" style={styles.receiptTitle}>
            {itemCount === 1
              ? t("cartItem")
              : t("cartItems", { count: itemCount })}
          </Text>
        </View>
        <OrderLines lines={purchase.lines} />
        <View style={styles.summary}>
          {purchase.seller.taxTreatment.kind === "vat_included" && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                {t("vatIncluded", {
                  rate: purchase.seller.taxTreatment.rateBasisPoints / 100,
                })}
              </Text>
              <Text style={styles.summaryValue}>
                {formatMoney(
                  {
                    currency: "CZK",
                    minorUnits: purchase.seller.taxTreatment.taxMinorUnits,
                  },
                  locale
                )}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t("confirmedTotal")}</Text>
            <Text style={styles.total}>
              {formatMoney(purchase.total, locale)}
            </Text>
          </View>
        </View>
      </View>

      {purchase.receiptStatus === "sent" && (
        <StatusBanner title={t("receiptSentGeneric")} tone="success" />
      )}
      {purchase.receiptStatus !== "sent" && (
        <StatusBanner title={t("receiptPending")} tone="info" />
      )}
      <SellerDetails seller={purchase.seller} />
      {(purchase.status === "not_started" ||
        purchase.status === "payment_pending") && (
        <ActionButton
          label={t("checkPayment")}
          onPress={() =>
            router.push(`/payment/${encodeURIComponent(purchase.id)}`)
          }
          variant="payment"
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    gap: spacing.lg,
    maxWidth: 768,
    width: "100%",
  },
  heading: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  orderId: { ...type.headline, color: palette.ink },
  purchaseDate: { ...type.body, color: palette.secondaryInk },
  receipt: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  receiptHeader: {
    backgroundColor: palette.surfaceMuted,
    borderBottomColor: palette.outline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  receiptTitle: { ...type.title, color: palette.ink },
  summary: {
    backgroundColor: palette.canvas,
    borderTopColor: palette.outline,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: spacing.md,
  },
  summaryRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  summaryLabel: { ...type.body, color: palette.secondaryInk },
  summaryValue: { ...type.body, color: palette.ink },
  totalRow: {
    alignItems: "center",
    borderTopColor: palette.outline,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
    paddingTop: spacing.md,
  },
  totalLabel: { ...type.title, color: palette.ink },
  total: { ...type.title, color: palette.action },
});
