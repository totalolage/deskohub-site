import "server-only";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect } from "effect";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import type { managePostOrderInvoiceSchema } from "@/features/accounting/post-order-invoice";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";

type PostOrderInvoiceRequest = StandardSchemaV1.InferOutput<
  typeof managePostOrderInvoiceSchema
>;

/** Creates or resends a paid reservation's invoice for its access holder. */
export const processPostOrderInvoiceRequest = Effect.fn(
  "processPostOrderInvoiceRequest"
)(function* (input: PostOrderInvoiceRequest) {
  const botProtection = yield* BotProtectionService;
  // Invoice: part of the customer's own purchase, so verified customer
  // agents may request it; the reservation access token still applies.
  yield* botProtection.verifyHuman({
    verificationFailurePolicy: "deny",
    verifiedBots: { allow: customerAgentNames },
    callSite: "accounting.manage-post-order-invoice",
  });
  const service = yield* ReservationInvoiceService;
  const access = {
    orderId: input.orderId,
    locale: input.locale,
    accessToken: input.accessToken,
  };
  if (input.operation === "resend") {
    yield* service.resendPostOrderInvoice(access);
    return { status: "resent" as const };
  }
  return yield* service.createPostOrderInvoice({
    ...access,
    address: input.address,
  });
});
