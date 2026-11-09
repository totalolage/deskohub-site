import { Option } from "effect";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { unitOf } from "@/shared/money/currencies";
import { type Money, moneyWithValue } from "@/shared/money/money";
import {
  localDateTimeToTemporalInstantString,
  workspaceSiteConstants,
} from "@/shared/utils";
import type { DiscountCodeTableItem } from "./admin-tables";
import type {
  CreateCustomerDiscountCodeAdminInput,
  CreateDiscountAdminInput,
  CreateDiscountCodeAdminInput,
  CreateVoucherAdminInput,
} from "./contracts";
import type {
  DiscountCodeConfigurationFormValues,
  DiscountCodeFormValues,
  DiscountDefinitionFormValues,
  VoucherFormValues,
} from "./form-schemas";
import { toDiscountProductTargets } from "./product-target-options";

/** None when a fixed amount's currency is outside the catalog. */
export const toCreateDiscountInput = (
  values: DiscountDefinitionFormValues
): Option.Option<CreateDiscountAdminInput> =>
  Option.map(toDiscountAdjustment(values), (adjustment) => ({
    labels: {
      "cs-CZ": values.labelCs,
      "en-US": values.labelEn,
    },
    adjustment,
    products: toDiscountProductTargets(values.products) as [
      WorkspaceProductTarget,
      ...WorkspaceProductTarget[],
    ],
  }));

const toDiscountAdjustment = (
  values: DiscountDefinitionFormValues
): Option.Option<CreateDiscountAdminInput["adjustment"]> =>
  values.adjustmentKind === "fixed"
    ? Option.map(
        toCatalogMoney(values.fixedAmountValue, values.fixedAmountCurrency),
        (amount) => ({ kind: "fixed", amount })
      )
    : Option.some({
        kind: "percentage",
        basisPoints: Math.round(Number(values.percentage) * 100),
      });

export const toCreateDiscountCodeInput = (
  values: DiscountCodeFormValues
): CreateDiscountCodeAdminInput => ({
  discountId: values.discountId as CreateDiscountCodeAdminInput["discountId"],
  ...toDiscountCodeConfigurationInput(values),
});

/**
 * A submitted code form as the code's full configuration. Its reservation
 * dates are always sent as a pair: both empty fields clear them, so an edit
 * that empties both removes the code's dates.
 */
export const toDiscountCodeConfigurationInput = (
  values: DiscountCodeConfigurationFormValues
): CreateCustomerDiscountCodeAdminInput["code"] => ({
  ...toPromotionConfigurationInput(values),
  maxUses: toOptionalCount(values.maxUses),
  maxUsesPerCustomer: toOptionalCount(values.maxUsesPerCustomer),
  serviceDateFrom: toOptionalValue(values.serviceDateFrom),
  serviceDateUntil: toOptionalValue(values.serviceDateUntil),
});

/**
 * An edited code's configuration. Reservation dates the editor still shows as
 * loaded are left out, so the update keeps whatever dates the code has now
 * instead of restoring the ones the editor opened with.
 */
export const toDiscountCodeUpdateInput = (
  values: DiscountCodeFormValues,
  loaded: Pick<DiscountCodeTableItem, "serviceDateFrom" | "serviceDateUntil">
): CreateDiscountCodeAdminInput => {
  const input = toCreateDiscountCodeInput(values);
  if (
    values.serviceDateFrom !== (loaded.serviceDateFrom ?? "") ||
    values.serviceDateUntil !== (loaded.serviceDateUntil ?? "")
  ) {
    return input;
  }
  const {
    serviceDateFrom: _serviceDateFrom,
    serviceDateUntil: _serviceDateUntil,
    ...unchangedDates
  } = input;
  return unchangedDates;
};

/** The code value, its switch, and its redemption window. */
const toPromotionConfigurationInput = (
  values: Pick<
    DiscountCodeConfigurationFormValues,
    "code" | "enabled" | "validFrom" | "validUntil"
  >
): Omit<CreateVoucherAdminInput, "credit"> => ({
  code: values.code
    .trim()
    .toUpperCase() as CreateCustomerDiscountCodeAdminInput["code"]["code"],
  enabled: values.enabled,
  validFrom: toOptionalLocalDateTimeInstant(
    values.validFrom
  ) as CreateCustomerDiscountCodeAdminInput["code"]["validFrom"],
  validUntil: toOptionalLocalDateTimeInstant(
    values.validUntil
  ) as CreateCustomerDiscountCodeAdminInput["code"]["validUntil"],
});

/** None when the voucher currency is outside the catalog. */
export const toVoucherCreditInput = (
  values: Pick<VoucherFormValues, "voucherValue" | "voucherCurrency">
): Option.Option<CreateVoucherAdminInput["credit"]> =>
  toCatalogMoney(values.voucherValue, values.voucherCurrency);

export const toVoucherConfigurationInput = (
  values: VoucherFormValues
): Omit<CreateVoucherAdminInput, "credit"> =>
  toPromotionConfigurationInput(values);

const toOptionalLocalDateTimeInstant = (value: string) =>
  value.length === 0
    ? null
    : localDateTimeToTemporalInstantString({
        dateTime: value,
        timeZone: workspaceSiteConstants.location.timeZone,
      });

const toOptionalCount = (value: string) =>
  value.length === 0 ? null : Number(value);

const toOptionalValue = (value: string) => (value.length === 0 ? null : value);

/** Entered minor units in the selected catalog currency. */
const toCatalogMoney = (
  minorUnits: string,
  currencyCode: string
): Option.Option<Money> =>
  Option.map(unitOf(currencyCode.toUpperCase()), (unit) =>
    moneyWithValue(Number(minorUnits), unit)
  );
