import type { DotyposDiscountGroupId } from "@deskohub/dotypos";
import { Data } from "effect";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type {
  DiscountCodeId,
  StoredDiscountId,
  VoucherId,
} from "../persistence-contracts";

export type DiscountAdminMissingResource =
  | { readonly kind: "discount"; readonly id: StoredDiscountId }
  | { readonly kind: "discount code"; readonly id: DiscountCodeId }
  | { readonly kind: "voucher"; readonly id: VoucherId }
  | {
      readonly kind: "Dotypos customer";
      readonly id: DotyposCustomerId;
    }
  | {
      readonly kind: "Dotypos discount group";
      readonly id: DotyposDiscountGroupId;
    }
  | {
      readonly kind: "code audience membership";
      readonly id: DotyposCustomerId;
    }
  | {
      readonly kind: "voucher audience membership";
      readonly id: DotyposCustomerId;
    };

export class DiscountAdminNotFoundError extends Data.TaggedError(
  "DiscountAdminNotFoundError"
)<{
  readonly resource: DiscountAdminMissingResource;
  readonly message: string;
}> {}
