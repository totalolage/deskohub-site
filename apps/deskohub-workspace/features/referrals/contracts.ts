import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Data } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { DiscountCandidate } from "@/features/discounts/provider";
import type { ReferralCode } from "./client";

export type ReferralAcceptance =
  | { readonly kind: "accepted" }
  | { readonly kind: "already_accepted" };

export type ReferralCodeKind =
  | { readonly kind: "referral" }
  | { readonly kind: "other" };

export type ReferralAccountSummary = {
  readonly code: ReferralCode;
  readonly eligibleInviteeCount: number;
  /** Exact percentage represented as a canonical decimal, without a percent sign. */
  readonly discount: string;
};

export type ReferralFailureReason =
  | "invalid_code"
  | "unavailable"
  | "self_referral"
  | "already_attributed"
  | "ineligible"
  | "account_unavailable";

export class ReferralError extends Data.TaggedError("ReferralError")<{
  readonly reason: ReferralFailureReason;
}> {}

export type ReferralCustomerIdentity = {
  readonly customerAccountId: CustomerAccountId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

export type ReferralCodeLookup = {
  readonly code: ReferralCode;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
};

export type ReferralCandidateInput = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: import("@/features/i18n").Locale;
  readonly product: WorkspaceProductIdentity;
};

export type ReferrerCandidateInput = ReferralCandidateInput & {
  readonly remainingSubtotal: WorkspaceMoney;
};

export type ReferralDiscountCandidate = DiscountCandidate | undefined;
