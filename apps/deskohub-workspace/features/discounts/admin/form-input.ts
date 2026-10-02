import {
  type WorkspaceProductTarget,
  workspaceProductTargets,
} from "@/features/discounts/product-target";
import { findWorkspaceCurrencyDefinition } from "@/shared/money/currencies";
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

export const toCreateDiscountInput = (
  values: DiscountDefinitionFormValues
): CreateDiscountAdminInput => {
  const fixedCurrency = findWorkspaceCurrencyDefinition(
    values.fixedAmountCurrency.toUpperCase()
  );

  return {
    labels: {
      "cs-CZ": values.labelCs,
      "en-US": values.labelEn,
    },
    adjustment:
      values.adjustmentKind === "fixed"
        ? {
            kind: "fixed",
            amount: {
              value: Number(values.fixedAmountValue),
              exponent: fixedCurrency?.exponent ?? -1,
              currency: fixedCurrency?.code ?? "",
            },
          }
        : {
            kind: "percentage",
            basisPoints: Math.round(Number(values.percentage) * 100),
          },
    products: values.products.flatMap((kind) => productTargets[kind] ?? []) as [
      WorkspaceProductTarget,
      ...WorkspaceProductTarget[],
    ],
  };
};

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

export const toVoucherCreditInput = (
  values: Pick<VoucherFormValues, "voucherValue" | "voucherCurrency">
): CreateVoucherAdminInput["credit"] => {
  const currency = findWorkspaceCurrencyDefinition(
    values.voucherCurrency.toUpperCase()
  );
  return {
    value: Number(values.voucherValue),
    exponent: currency?.exponent ?? -1,
    currency: currency?.code ?? "",
  };
};

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

const productTargets: Readonly<
  Record<string, readonly WorkspaceProductTarget[]>
> = Object.fromEntries(
  workspaceProductTargets.map((product) => [product.kind, [product]])
);
