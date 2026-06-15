import type { DotyposCustomerDiscount } from "@deskohub/dotypos";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";

export type WorkspaceCustomerDiscount = {
  readonly source: DotyposCustomerDiscount["source"];
  readonly discountGroupId: string;
  readonly percent: number;
  readonly amount: WorkspaceMoney;
};

export const applyWorkspaceCustomerDiscount = (
  price: WorkspaceMoney,
  customerDiscount: DotyposCustomerDiscount | undefined
): {
  readonly expectedPrice: WorkspaceMoney;
  readonly customerDiscount?: WorkspaceCustomerDiscount;
} => {
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
