import { getWorkspaceProductTargetKey } from "@/features/discounts/product-target";
import { defaultWorkspaceCurrencyCode } from "@/shared/money/currencies";
import {
  temporalInstantToLocalDateTimeString,
  workspaceSiteConstants,
} from "@/shared/utils";
import type {
  DiscountCodeTableItem,
  DiscountTableItem,
  VoucherTableItem,
} from "./admin-tables";
import type {
  DiscountCodeConfigurationFormValues,
  DiscountCodeFormValues,
  DiscountDefinitionFormValues,
  VoucherFormValues,
} from "./form-schemas";

// Each form starts from the edited row's values, or from these new-item
// defaults when it creates one.

export const discountDefinitionFormDefaults = (
  discount?: DiscountTableItem
): DiscountDefinitionFormValues => ({
  labelEn: discount?.labels["en-US"] ?? "",
  labelCs: discount?.labels["cs-CZ"] ?? "",
  adjustmentKind: discount?.adjustment.kind ?? "percentage",
  percentage:
    discount?.adjustment.kind === "percentage"
      ? String(discount.adjustment.basisPoints / 100)
      : "10",
  fixedAmountValue:
    discount?.adjustment.kind === "fixed"
      ? String(discount.adjustment.amount.value)
      : "10000",
  fixedAmountCurrency:
    discount?.adjustment.kind === "fixed"
      ? discount.adjustment.amount.currency
      : defaultWorkspaceCurrencyCode,
  products: discount?.products.map(getWorkspaceProductTargetKey) ?? [],
});

export const discountCodeFormDefaults = (
  code?: DiscountCodeTableItem
): DiscountCodeFormValues => ({
  discountId: code?.discountId ?? "",
  ...discountCodeConfigurationFormDefaults(code),
});

const discountCodeConfigurationFormDefaults = (
  code?: DiscountCodeTableItem
): DiscountCodeConfigurationFormValues => ({
  ...codeAvailabilityFormDefaults(code),
  ...usageLimitFormDefaults(code),
  serviceDateFrom: code?.serviceDateFrom ?? "",
  serviceDateUntil: code?.serviceDateUntil ?? "",
});

export const voucherFormDefaults = (
  voucher?: VoucherTableItem
): VoucherFormValues => ({
  voucherValue: voucher ? String(voucher.issuedCredit.value) : "10000",
  voucherCurrency:
    voucher?.issuedCredit.currency ?? defaultWorkspaceCurrencyCode,
  ...codeAvailabilityFormDefaults(voucher),
});

/** The code, its switch, and the window in which it can be redeemed. */
const codeAvailabilityFormDefaults = (
  item?: DiscountCodeTableItem | VoucherTableItem
) => ({
  code: item?.code ?? "",
  enabled: item?.enabled ?? true,
  validFrom: toDateTimeInputValue(item?.validFrom),
  validUntil: toDateTimeInputValue(item?.validUntil),
});

/** Vouchers have no usage limits, so their limit fields start empty. */
const usageLimitFormDefaults = (
  item?: DiscountCodeTableItem | VoucherTableItem
) => ({
  maxUses:
    item && "maxUses" in item ? toUsageLimitInputValue(item.maxUses) : "",
  maxUsesPerCustomer:
    item && "maxUsesPerCustomer" in item
      ? toUsageLimitInputValue(item.maxUsesPerCustomer)
      : "",
});

const toUsageLimitInputValue = (limit: number | null) =>
  limit !== null ? String(limit) : "";

const toDateTimeInputValue = (value: string | null | undefined) =>
  value
    ? temporalInstantToLocalDateTimeString({
        instant: Temporal.Instant.from(value),
        timeZone: workspaceSiteConstants.location.timeZone,
      })
    : "";
