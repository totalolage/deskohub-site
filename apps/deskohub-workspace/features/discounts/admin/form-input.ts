import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
  workspaceProductIdentities,
} from "@/features/checkout/product-identity";
import { findWorkspaceCurrencyDefinition } from "@/shared/money/currencies";
import {
  localDateTimeToTemporalInstantString,
  workspaceSiteConstants,
} from "@/shared/utils";
import type {
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
      ) as [WorkspaceProductIdentity, ...WorkspaceProductIdentity[]],
  };
};

export const readDiscountCodeForm = (
  formData: FormData
): CreateDiscountCodeAdminInput => ({
  discountId: readString(
    formData,
    "discountId"
  ) as CreateDiscountCodeAdminInput["discountId"],
  code: readString(formData, "code")
    .trim()
    .toUpperCase() as CreateDiscountCodeAdminInput["code"],
  enabled: formData.get("enabled") === "on",
  validFrom: readOptionalLocalDateTime(
    formData,
    "validFrom"
  ) as CreateDiscountCodeAdminInput["validFrom"],
  validUntil: readOptionalLocalDateTime(
    formData,
    "validUntil"
  ) as CreateDiscountCodeAdminInput["validUntil"],
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
  Record<string, readonly WorkspaceProductIdentity[]>
> = Object.fromEntries(
  workspaceProductIdentities.map((product) => [
    getWorkspaceProductKey(product),
    [product],
  ])
);
