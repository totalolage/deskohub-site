import type { Discount, DiscountProductIdentity } from "./contracts";
import type { DiscountCodeId, StoredDiscountId } from "./persistence-contracts";

export type DiscountProvenance = {
  readonly providerNamespace: string;
  readonly providerReference: string;
  readonly details?: Readonly<Record<string, unknown>>;
};

export type DiscountClaimInstruction = {
  readonly kind: "discount_code";
  readonly codeId: DiscountCodeId;
  readonly storedDiscountId: StoredDiscountId;
  readonly dotyposCustomerId: string;
  readonly product: DiscountProductIdentity;
};

export type DiscountCandidate = {
  readonly discount: Discount;
  readonly provenance: DiscountProvenance;
  readonly claim?: DiscountClaimInstruction;
};
