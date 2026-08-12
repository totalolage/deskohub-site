import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { BackHeader } from "@/components/BackHeader";
import { StatePanel, StatusBanner } from "@/components/Controls";
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
        header={false}
        navigationHeader={<BackHeader title={t("orderDetailTitle")} />}
      >
        {actionError && <StatePanel mark="!" title={t("errorTitle")} />}
        {!actionError && <StatePanel mark="…" title={t("loadingTitle")} />}
      </AppScreen>
    );
  }

  return (
    <AppScreen
      header={false}
      navigationHeader={<BackHeader title={t("orderDetailTitle")} />}
    >
      <Text style={styles.purchaseDate}>
        {t("purchasedAt", {
          date: formatPragueDateTime(purchase.createdAt, locale),
        })}
      </Text>
      <View style={styles.summary}>
        <View style={styles.summaryTopline}>
          <Text style={styles.orderId}>
            {t("orderNumber", { id: purchase.publicReference })}
          </Text>
          <PurchaseStatusBadge status={purchase.status} />
        </View>
        <Text style={styles.total}>{formatMoney(purchase.total, locale)}</Text>
      </View>
      <OrderLines lines={purchase.lines} />
      <View style={styles.gap} />
      {purchase.receiptStatus === "sent" && (
        <StatusBanner title={t("receiptSentGeneric")} tone="success" />
      )}
      {purchase.receiptStatus !== "sent" && (
        <StatusBanner title={t("receiptPending")} tone="info" />
      )}
      <View style={styles.gap} />
      <SellerDetails seller={purchase.seller} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  summary: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  summaryTopline: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  orderId: { ...type.bodyStrong, color: palette.navy },
  total: { ...type.display, color: palette.navy },
  purchaseDate: {
    ...type.body,
    color: palette.navyMuted,
    marginBottom: spacing.md,
  },
  gap: { height: spacing.md },
});
