import { m } from "@/features/administration/i18n";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { Locale } from "@/features/i18n";
import type { AdminCustomerProfile } from "./discount-administration.service";

/** The customer's Dotypos discount group with its percentage, or why none shows. */
export const formatCustomerDiscountGroup = (
  profile: AdminCustomerProfile,
  locale: Locale
): string => {
  const { discountGroupId } = profile.customer;
  const currentGroup = profile.discountGroups.find(
    ({ id }) => id === discountGroupId
  );
  if (currentGroup) {
    return `${currentGroup.name} (${formatDiscountAdjustment(
      { kind: "percentage", basisPoints: currentGroup.basisPoints },
      locale
    )})`;
  }
  return discountGroupId
    ? m.discountsCustomerGroupUnavailable(
        { groupId: discountGroupId },
        { locale }
      )
    : m.discountsCustomerGroupNone({}, { locale });
};

/**
 * The codes and vouchers the customer may use: those limited to them and
 * those open to everyone, enabled first, then the customer's own, then by code.
 */
export const customerVisiblePromotionCodes = (
  profile: AdminCustomerProfile,
  locale: Locale
) =>
  [
    ...profile.codes.map(
      ({
        audienceSize,
        code,
        discountAdjustment,
        discountLabels,
        eligible,
        enabled,
        id,
      }) => ({
        kind: "discount-code" as const,
        audienceSize,
        code,
        discountAdjustment,
        discountLabel: discountLabels[locale],
        eligible,
        enabled,
        id,
      })
    ),
    ...profile.vouchers.map(
      ({
        audienceSize,
        code,
        eligible,
        enabled,
        id,
        issuedCredit,
        remainingCredit,
      }) => ({
        kind: "voucher" as const,
        audienceSize,
        code,
        eligible,
        enabled,
        id,
        issuedCredit,
        remainingCredit,
      })
    ),
  ]
    .filter((item) => item.eligible || item.audienceSize === 0)
    .toSorted(
      (left, right) =>
        Number(right.enabled) - Number(left.enabled) ||
        Number(right.eligible) - Number(left.eligible) ||
        left.code.localeCompare(right.code)
    );

/** Enabled codes limited to the customer, and enabled codes open to everyone. */
export const countCustomerAvailableCodes = (
  codes: AdminCustomerProfile["codes"]
) => ({
  targeted: codes.filter(
    (code) => code.enabled && code.eligible && code.audienceSize > 0
  ).length,
  universal: codes.filter((code) => code.enabled && code.audienceSize === 0)
    .length,
});

/** The customer's code and voucher claims, newest first. */
export const customerClaimHistory = (profile: AdminCustomerProfile) =>
  [...profile.claims, ...profile.voucherClaims].toSorted((left, right) =>
    Temporal.Instant.compare(right.reservedAt, left.reservedAt)
  );

/** Code values keyed by `discount-code:<id>` or `voucher:<id>`. */
export const customerPromotionCodeValues = (profile: AdminCustomerProfile) =>
  new Map([
    ...profile.codes.map(
      ({ code, id }) => [`discount-code:${id}`, code] as const
    ),
    ...profile.vouchers.map(({ code, id }) => [`voucher:${id}`, code] as const),
  ]);
