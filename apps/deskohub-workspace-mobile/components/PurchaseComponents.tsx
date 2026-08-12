import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { palette, radii, spacing, type } from "@/constants/Theme";
import {
  formatMoney,
  formatPragueDateTime,
  localizeText,
} from "@/src/domain/format";
import type {
  Purchase,
  PurchaseStatus,
  QuoteLine,
  Seller,
} from "@/src/domain/shop";
import { useShop } from "@/src/state/shop-provider";

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  const { t } = useShop();
  const labels = {
    not_started: t("notStarted"),
    paid: t("paid"),
    payment_pending: t("paymentPending"),
    failed: t("failed"),
    cancelled: t("cancelled"),
    expired: t("expired"),
  } as const;
  const colors = {
    not_started: {
      backgroundColor: palette.surfaceMuted,
      color: palette.navyMuted,
    },
    paid: {
      backgroundColor: palette.successSurface,
      color: palette.aquamarineInk,
    },
    payment_pending: {
      backgroundColor: palette.warningSurface,
      color: palette.orangeInk,
    },
    failed: { backgroundColor: palette.dangerSurface, color: palette.danger },
    cancelled: {
      backgroundColor: palette.surfaceMuted,
      color: palette.navyMuted,
    },
    expired: {
      backgroundColor: palette.surfaceMuted,
      color: palette.navyMuted,
    },
  } as const;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors[status].backgroundColor },
      ]}
    >
      <Text style={[styles.badgeText, { color: colors[status].color }]}>
        {labels[status]}
      </Text>
    </View>
  );
}

export function PurchaseRow({
  purchase,
  onPress,
}: {
  purchase: Purchase;
  onPress: () => void;
}) {
  const { locale, t } = useShop();
  let statusMarkStyle: ViewStyle = styles.statusNeutral;
  let statusMark = "×";
  if (purchase.status === "paid") {
    statusMarkStyle = styles.statusPaid;
    statusMark = "✓";
  } else if (purchase.status === "payment_pending") {
    statusMarkStyle = styles.statusPending;
    statusMark = "◷";
  } else if (purchase.status === "failed") {
    statusMarkStyle = styles.statusFailed;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.purchaseRow, pressed && styles.pressed]}
    >
      <View style={[styles.statusIcon, statusMarkStyle]}>
        <Text style={styles.statusIconText}>{statusMark}</Text>
      </View>
      <View style={styles.purchaseCopy}>
        <View style={styles.purchaseTopline}>
          <Text style={styles.purchaseId}>
            {t("orderNumber", { id: purchase.publicReference })}
          </Text>
          <Text style={styles.purchaseTotal}>
            {formatMoney(purchase.total, locale)}
          </Text>
        </View>
        <Text style={styles.purchaseDate}>
          {t("purchasedAt", {
            date: formatPragueDateTime(purchase.createdAt, locale),
          })}
        </Text>
        <View style={styles.purchaseBottomline}>
          <Text numberOfLines={1} style={styles.purchaseItems}>
            {purchase.lines
              .map(
                (line) => `${line.quantity}× ${localizeText(line.name, locale)}`
              )
              .join(" · ")}
          </Text>
          <PurchaseStatusBadge status={purchase.status} />
        </View>
      </View>
      <Text aria-hidden style={styles.rowChevron}>
        ›
      </Text>
    </Pressable>
  );
}

export function OrderLines({ lines }: { lines: readonly QuoteLine[] }) {
  const { locale } = useShop();
  return (
    <View style={styles.lines}>
      {lines.map((line) => (
        <View key={line.productId} style={styles.line}>
          <View style={styles.lineCopy}>
            <Text style={styles.lineName}>
              {localizeText(line.name, locale)}
            </Text>
            <Text style={styles.lineMeta}>
              {line.quantity} × {formatMoney(line.unitPrice, locale)}
            </Text>
          </View>
          <Text style={styles.lineTotal}>
            {formatMoney(line.lineTotal, locale)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function SellerDetails({ seller }: { seller: Seller }) {
  const { t } = useShop();
  return (
    <View style={styles.seller}>
      <Text style={styles.sellerLabel}>{t("seller")}</Text>
      <Text style={styles.sellerName}>{seller.legalName}</Text>
      <Text style={styles.sellerMeta}>
        {t("sellerId", { id: seller.identificationNumber })}
      </Text>
      {seller.taxTreatment.kind === "not_vat_payer" && (
        <Text style={styles.sellerMeta}>{t("notVatPayer")}</Text>
      )}
      {seller.taxTreatment.kind === "vat_included" && (
        <Text style={styles.sellerMeta}>
          {t("vatIncluded", {
            rate: seller.taxTreatment.rateBasisPoints / 100,
          })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  badgeText: { ...type.caption, fontWeight: "700" },
  purchaseRow: {
    alignItems: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 112,
    padding: spacing.md,
  },
  purchaseCopy: { flex: 1, gap: spacing.xxs },
  purchaseTopline: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  purchaseId: { ...type.bodyStrong, color: palette.navy, flex: 1 },
  purchaseDate: { ...type.caption, color: palette.navyMuted },
  purchaseBottomline: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  purchaseItems: { ...type.caption, color: palette.navyMuted, flex: 1 },
  purchaseTotal: { ...type.bodyStrong, color: palette.navy },
  statusIcon: {
    alignItems: "center",
    borderRadius: radii.full,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  statusPaid: { backgroundColor: palette.successSurface },
  statusPending: { backgroundColor: palette.warningSurface },
  statusFailed: { backgroundColor: palette.dangerSurface },
  statusNeutral: { backgroundColor: palette.surfaceMuted },
  statusIconText: { color: palette.navy, fontSize: 22, fontWeight: "800" },
  rowChevron: { color: palette.navyMuted, fontSize: 28 },
  pressed: { opacity: 0.75 },
  lines: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  line: {
    alignItems: "center",
    borderBottomColor: palette.surfaceMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 72,
    padding: spacing.md,
  },
  lineCopy: { flex: 1 },
  lineName: { ...type.bodyStrong, color: palette.navy },
  lineMeta: { ...type.caption, color: palette.navyMuted },
  lineTotal: { ...type.bodyStrong, color: palette.navy },
  seller: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
    padding: spacing.md,
  },
  sellerLabel: { ...type.caption, color: palette.navyMuted },
  sellerName: { ...type.bodyStrong, color: palette.navy },
  sellerMeta: { ...type.caption, color: palette.navyMuted },
});
