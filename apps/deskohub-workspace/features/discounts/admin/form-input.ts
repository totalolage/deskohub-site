import {
  getWorkspaceProductTargetKey,
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
} from "./contracts";

export const readDiscountForm = (
  formData: FormData
): CreateDiscountAdminInput => {
  const kind = readString(formData, "adjustmentKind");
  const fixedCurrency = findWorkspaceCurrencyDefinition(
    readString(formData, "fixedAmountCurrency").toUpperCase()
  );

  return {
    labels: {
      "cs-CZ": readString(formData, "labelCs"),
      "en-US": readString(formData, "labelEn"),
    },
    adjustment:
      kind === "fixed"
        ? {
            kind: "fixed",
            amount: {
              value: Number(readString(formData, "fixedAmountValue")),
              exponent: fixedCurrency?.exponent ?? -1,
              currency: fixedCurrency?.code ?? "",
            },
          }
        : {
            kind: "percentage",
            basisPoints: Math.round(
              Number(readString(formData, "percentage")) * 100
            ),
          },
    products: formData
      .getAll("products")
      .flatMap((value) =>
        typeof value === "string" ? (productIdentities[value] ?? []) : []
      ) as [WorkspaceProductTarget, ...WorkspaceProductTarget[]],
  };
};

export const readDiscountCodeForm = (
  formData: FormData
): CreateDiscountCodeAdminInput => ({
  discountId: readString(
    formData,
    "discountId"
  ) as CreateDiscountCodeAdminInput["discountId"],
  ...readDiscountCodeConfigurationForm(formData),
});

export const readDiscountCodeConfigurationForm = (
  formData: FormData
): CreateCustomerDiscountCodeAdminInput["code"] => ({
  code: readString(formData, "code")
    .trim()
    .toUpperCase() as CreateCustomerDiscountCodeAdminInput["code"]["code"],
  enabled: formData.get("enabled") === "on",
  validFrom: readOptionalLocalDateTime(
    formData,
    "validFrom"
  ) as CreateCustomerDiscountCodeAdminInput["code"]["validFrom"],
  validUntil: readOptionalLocalDateTime(
    formData,
    "validUntil"
  ) as CreateCustomerDiscountCodeAdminInput["code"]["validUntil"],
  maxUses: readOptionalNumber(formData, "maxUses"),
});

const readString = (formData: FormData, field: string) => {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
};

const readOptionalString = (formData: FormData, field: string) => {
  const value = readString(formData, field).trim();
  return value.length > 0 ? value : null;
};

const readOptionalLocalDateTime = (formData: FormData, field: string) => {
  const value = readOptionalString(formData, field);
  return value === null
    ? null
    : localDateTimeToTemporalInstantString({
        dateTime: value,
        timeZone: workspaceSiteConstants.location.timeZone,
      });
};

const readOptionalNumber = (formData: FormData, field: string) => {
  const value = readOptionalString(formData, field);
  return value === null ? null : Number(value);
};

const productIdentities: Readonly<
  Record<string, readonly WorkspaceProductTarget[]>
> = Object.fromEntries(
  workspaceProductTargets.map((product) => [
    getWorkspaceProductTargetKey(product),
    [product],
  ])
);
