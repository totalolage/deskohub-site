import "@/shared/polyfills/temporal";

import { expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import { BotDetectedError } from "@/shared/backend/bot-protection/bot-protection.service";
import { BotProtectionServiceMock } from "@/shared/backend/bot-protection/bot-protection.service.mock";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";
import { processPostOrderInvoiceRequest } from "./post-order-invoice-request";

const request = {
  locale: "en-US",
  orderId: "SYNTHETIC-ORDER-ID",
  accessToken: "synthetic-access-token",
  operation: "resend",
} as never;

const runRequest = (
  verifyHuman: () => Effect.Effect<void, BotDetectedError>
) => {
  const resendPostOrderInvoice = mock(() => Effect.void);
  const effect = processPostOrderInvoiceRequest(request).pipe(
    Effect.provide(
      Layer.mergeAll(
        BotProtectionServiceMock({ verifyHuman }),
        Layer.mock(ReservationInvoiceService)({ resendPostOrderInvoice })
      )
    )
  );
  return { effect, resendPostOrderInvoice };
};

test("verifies the request with the customer-agent allow list before resending", async () => {
  const verifyHuman = mock(() => Effect.void);
  const { effect, resendPostOrderInvoice } = runRequest(verifyHuman);

  await expect(Effect.runPromise(effect)).resolves.toEqual({
    status: "resent",
  });
  expect(verifyHuman).toHaveBeenCalledWith({
    verificationFailurePolicy: "deny",
    verifiedBots: { allow: customerAgentNames },
    callSite: "accounting.manage-post-order-invoice",
  });
  expect(resendPostOrderInvoice).toHaveBeenCalledTimes(1);
});

test("rejects a detected bot before touching the invoice", async () => {
  const { effect, resendPostOrderInvoice } = runRequest(() =>
    Effect.fail(
      new BotDetectedError({
        message: "Automated request detected",
        reason: "unverified_bot",
      })
    )
  );

  const error = await Effect.runPromise(Effect.flip(effect));

  expect(error).toBeInstanceOf(BotDetectedError);
  expect(resendPostOrderInvoice).not.toHaveBeenCalled();
});
