import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Data, Schema } from "effect";

export const customerAccountIdSchema = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(255)
)
  .pipe(Schema.brand("CustomerAccountId"))
  .annotate({
    identifier: "CustomerAccountId",
    description: "Opaque identifier assigned by Neon Auth.",
  });

export type CustomerAccountId = typeof customerAccountIdSchema.Type;

export type LinkedCustomerAccount = {
  readonly accountId: CustomerAccountId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

export type CustomerAccountAccessFailure =
  | "not-configured"
  | "unauthenticated"
  | "unverified-email"
  | "link-required"
  | "unavailable";

export type CustomerAccountLinkFailure = "not-found" | "ambiguous" | "claimed";

export class CustomerAccountAccessError extends Data.TaggedError(
  "CustomerAccountAccessError"
)<{
  readonly reason: CustomerAccountAccessFailure;
  readonly linkReason?: CustomerAccountLinkFailure;
}> {}
