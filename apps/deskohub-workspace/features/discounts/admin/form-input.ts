import { Option } from "effect";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { unitOf } from "@/shared/money/currencies";
import { type Money, moneyWithValue } from "@/shared/money/money";
import {
  localDateTimeToTemporalInstantString,
  workspaceSiteConstants,
} from "@/shared/utils";
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

export const toDiscountCodeConfigurationInput = (
  values: DiscountCodeConfigurationFormValues
): CreateCustomerDiscountCodeAdminInput["code"] => ({
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
  maxUses: toOptionalCount(values.maxUses),
  maxUsesPerCustomer: toOptionalCount(values.maxUsesPerCustomer),
});

/** None when the voucher currency is outside the catalog. */
export const toVoucherCreditInput = (
  values: Pick<VoucherFormValues, "voucherValue" | "voucherCurrency">
): Option.Option<CreateVoucherAdminInput["credit"]> =>
  toCatalogMoney(values.voucherValue, values.voucherCurrency);

export const toVoucherConfigurationInput = (
  values: VoucherFormValues
): Omit<CreateVoucherAdminInput, "credit"> => {
  const {
    maxUses: _maxUses,
    maxUsesPerCustomer: _maxUsesPerCustomer,
    ...configuration
  } = toDiscountCodeConfigurationInput({
    ...values,
    maxUses: "",
    maxUsesPerCustomer: "",
  });
  return configuration;
};

const toOptionalLocalDateTimeInstant = (value: string) =>
  value.length === 0
    ? null
    : localDateTimeToTemporalInstantString({
        dateTime: value,
        timeZone: workspaceSiteConstants.location.timeZone,
      });

const toOptionalCount = (value: string) =>
  value.length === 0 ? null : Number(value);

/** Entered minor units in the selected catalog currency. */
const toCatalogMoney = (
  minorUnits: string,
  currencyCode: string
): Option.Option<Money> =>
  Option.map(unitOf(currencyCode.toUpperCase()), (unit) =>
    moneyWithValue(Number(minorUnits), unit)
  );
