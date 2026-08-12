import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
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
      color: palette.neutralInk,
    },
    paid: {
      backgroundColor: palette.successSurface,
      color: palette.positiveInk,
    },
    payment_pending: {
      backgroundColor: palette.warningSurface,
      color: palette.warningInk,
    },
    failed: {
      backgroundColor: palette.dangerSurface,
      color: palette.dangerInk,
    },
    cancelled: {
      backgroundColor: palette.surfaceMuted,
      color: palette.neutralInk,
    },
    expired: {
      backgroundColor: palette.surfaceMuted,
      color: palette.neutralInk,
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
  divided = false,
}: {
  purchase: Purchase;
  onPress: () => void;
  divided?: boolean;
}) {
  const { locale, t } = useShop();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.purchaseRow,
        divided && styles.purchaseRowDivided,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.purchaseHeading}>
        <View style={styles.purchaseIdentityGroup}>
          <View style={styles.orderIcon}>
            <AppIcon
              color={palette.secondaryInk}
              name={{
                ios: "receipt",
                android: "receipt_long",
                web: "receipt_long",
              }}
              size={22}
            />
          </View>
          <View style={styles.purchaseIdentity}>
            <Text numberOfLines={1} style={styles.purchaseId}>
              {t("orderNumber", { id: purchase.publicReference })}
            </Text>
            <Text numberOfLines={1} style={styles.purchaseDate}>
              {t("purchasedAt", {
                date: formatPragueDateTime(purchase.createdAt, locale),
              })}
            </Text>
          </View>
        </View>
        <View style={styles.purchaseValue}>
          <Text style={styles.purchaseTotal}>
            {formatMoney(purchase.total, locale)}
          </Text>
          <PurchaseStatusBadge status={purchase.status} />
        </View>
      </View>
      <Text numberOfLines={1} style={styles.purchaseItems}>
        {purchase.lines
          .map((line) => localizeText(line.name, locale))
          .join(", ")}
      </Text>
    </Pressable>
  );
}

export function OrderLines({ lines }: { lines: readonly QuoteLine[] }) {
  const { locale } = useShop();

  return (
    <View style={styles.lines}>
      {lines.map((line, index) => (
        <View
          key={line.productId}
          style={[styles.line, index > 0 && styles.lineDivided]}
        >
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
    borderRadius: 4,
    justifyContent: "center",
    minHeight: 28,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "500",
    lineHeight: 16,
    textTransform: "uppercase",
  },
  purchaseRow: {
    backgroundColor: palette.surface,
    gap: spacing.xxs,
    padding: spacing.sm,
  },
  purchaseRowDivided: {
    borderTopColor: palette.outline,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  purchaseHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  purchaseIdentityGroup: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  orderIcon: {
    alignItems: "center",
    backgroundColor: palette.surfaceMuted,
    borderRadius: 4,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  purchaseIdentity: { flex: 1, minWidth: 0 },
  purchaseId: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  purchaseDate: {
    color: palette.secondaryInk,
    fontSize: 12,
    lineHeight: 20,
  },
  purchaseItems: {
    ...type.caption,
    color: palette.secondaryInk,
    paddingLeft: 48,
  },
  purchaseValue: {
    alignItems: "flex-end",
    flexShrink: 0,
    gap: spacing.xxs,
  },
  purchaseTotal: { ...type.bodyStrong, color: palette.ink },
  pressed: { opacity: 0.72 },
  lines: { backgroundColor: palette.surface },
  line: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 80,
    padding: spacing.md,
  },
  lineDivided: {
    borderTopColor: palette.outline,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  lineCopy: { flex: 1, gap: spacing.xxs },
  lineName: { ...type.body, color: palette.ink },
  lineMeta: { ...type.body, color: palette.secondaryInk },
  lineTotal: { ...type.body, color: palette.ink },
  seller: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xxs,
    padding: spacing.md,
  },
  sellerLabel: { ...type.label, color: palette.secondaryInk },
  sellerName: { ...type.bodyStrong, color: palette.ink },
  sellerMeta: { ...type.body, color: palette.secondaryInk },
});
