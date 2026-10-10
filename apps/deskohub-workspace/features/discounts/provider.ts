import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { Discount } from "./contracts";
import type {
  DiscountCodeId,
  PromotionCodeId,
  StoredDiscountId,
  VoucherId,
} from "./persistence-contracts";

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
      }
    | {
        readonly referralInvitation: {
          readonly invitedDotyposCustomerId: DotyposCustomerId;
          readonly referrerDotyposCustomerId: DotyposCustomerId;
          readonly promotionCodeId: PromotionCodeId;
        };
      }
    | {
        readonly referralReferrer: {
          readonly referrerDotyposCustomerId: DotyposCustomerId;
          readonly eligibleInviteeCount: number;
          readonly discountPercentage: string;
        };
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
    }
  | {
      readonly kind: "referral_invitation";
      readonly invitedDotyposCustomerId: DotyposCustomerId;
      readonly referrerDotyposCustomerId: DotyposCustomerId;
      readonly promotionCodeId: PromotionCodeId;
    };

export type DiscountCandidate = {
  readonly discount: Discount;
  readonly provenance: DiscountProvenance;
  readonly claim?: DiscountClaimInstruction;
};
