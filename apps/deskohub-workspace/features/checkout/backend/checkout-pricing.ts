import type { WorkspaceMoney } from "@/features/checkout/product-catalog";

type DotyposCustomerDiscountField =
  | "_discountGroupId"
  | "discountPercent"
  | "discountpercent"
  | "discountPercentage"
  | "customerDiscountPercent";

export type WorkspaceCustomerDiscount = {
  readonly source: "dotypos-customer";
  readonly field: DotyposCustomerDiscountField;
  readonly percent: number;
  readonly amount: WorkspaceMoney;
};

type DotyposCustomerDiscountFields = {
  readonly [field in DotyposCustomerDiscountField]?: unknown;
};

const dotyposCustomerDiscountFields = [
  "discountPercent",
  "discountpercent",
  "discountPercentage",
  "customerDiscountPercent",
  "_discountGroupId",
] as const satisfies readonly DotyposCustomerDiscountField[];

const parseDiscountPercent = (value: unknown) => {
  const percent =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(percent)) return undefined;
  if (percent <= 0 || percent > 100) return undefined;

  return percent;
};

export const getDotyposCustomerDiscount = (
  customer: DotyposCustomerDiscountFields
): Omit<WorkspaceCustomerDiscount, "amount"> | undefined => {
  for (const field of dotyposCustomerDiscountFields) {
    const percent = parseDiscountPercent(customer[field]);
    if (percent !== undefined) {
      return { source: "dotypos-customer", field, percent };
    }
  }

  return undefined;
};

export const applyWorkspaceCustomerDiscount = (
  price: WorkspaceMoney,
  customer: DotyposCustomerDiscountFields
): {
  readonly expectedPrice: WorkspaceMoney;
  readonly customerDiscount?: WorkspaceCustomerDiscount;
} => {
  const customerDiscount = getDotyposCustomerDiscount(customer);
  if (!customerDiscount) return { expectedPrice: price };

  const discountValue = Math.round(
    (price.value * customerDiscount.percent) / 100
  );
  if (discountValue <= 0) return { expectedPrice: price };

  const amount = { ...price, value: discountValue };

  return {
    expectedPrice: {
      ...price,
      value: Math.max(0, price.value - discountValue),
    },
    customerDiscount: {
      ...customerDiscount,
      amount,
    },
  };
};
