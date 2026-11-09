import { DotyposCustomerIdSchema } from "@deskohub/dotypos/types";
import { Schema } from "effect";
import { customerAccountIdSchema } from "./customer-account";

/** Same-origin route that reads the signed-in account's Dotypos customer link. */
export const accountCustomerLinkPath = "/api/account/customer-link";

/**
 * `accountId` is null without a verified session; `dotyposCustomerId` is null
 * while the account has no Dotypos customer. The response never carries
 * contact data.
 */
export const accountCustomerLinkResponseSchema = Schema.Struct({
  accountId: Schema.NullOr(customerAccountIdSchema),
  dotyposCustomerId: Schema.NullOr(DotyposCustomerIdSchema),
});

export type AccountCustomerLinkResponse =
  typeof accountCustomerLinkResponseSchema.Type;
