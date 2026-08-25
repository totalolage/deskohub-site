import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { Discount, GoodsDiscountBasketLineInput } from "./contracts";
import type {
  DiscountCodeId,
  StoredDiscountId,
  VoucherId,
} from "./persistence-contracts";
import type { WorkspaceProductTarget } from "./product-target";
import { workspaceProductTargetMatches } from "./product-target";

export type DiscountProvenance = {
  readonly providerNamespace: string;
  readonly providerReference: string;
  readonly details?:
    | {
        readonly calendarId: string;
        readonly eventReference: string;
        readonly occurrenceDate: string;
        readonly storedDiscountId: StoredDiscountId;
      }
    | {
        readonly discountCodeId: DiscountCodeId;
        readonly storedDiscountId: StoredDiscountId;
      }
    | {
        readonly voucherId: VoucherId;
      }
    | {
        readonly discountGroupId: string;
        readonly dotyposCustomerId: DotyposCustomerId;
      };
};

export type DiscountClaimInstruction =
  | {
      readonly kind: "discount_code";
      readonly codeId: DiscountCodeId;
      readonly storedDiscountId: StoredDiscountId;
      readonly dotyposCustomerId: DotyposCustomerId;
      readonly product: WorkspaceProductIdentity;
    }
  | {
      readonly kind: "voucher";
      readonly voucherId: VoucherId;
      readonly availableAmount: WorkspaceMoney;
      readonly dotyposCustomerId: DotyposCustomerId;
    };

export type DiscountCandidate = {
  readonly discount: Discount;
  readonly provenance: DiscountProvenance;
  readonly claim?: DiscountClaimInstruction;
};

export type GoodsBasketDiscountCandidate = {
  readonly candidate: DiscountCandidate;
  readonly eligibleLineIndexes: readonly number[];
};

export const allGoodsBasketLinesEligible = (
  lines: readonly GoodsDiscountBasketLineInput[]
): readonly number[] => lines.map((_, index) => index);

export const getEligibleGoodsBasketLineIndexes = (input: {
  readonly lines: readonly GoodsDiscountBasketLineInput[];
  readonly targets: readonly WorkspaceProductTarget[];
}): readonly number[] =>
  input.lines.flatMap(({ product }, index) =>
    input.targets.some((target) =>
      workspaceProductTargetMatches(target, product)
    )
      ? [index]
      : []
  );
