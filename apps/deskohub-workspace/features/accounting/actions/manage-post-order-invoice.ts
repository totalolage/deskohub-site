"use server";

import { Effect } from "effect";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import { managePostOrderInvoiceSchema } from "@/features/accounting/post-order-invoice";
import { m } from "@/features/i18n";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const managePostOrderInvoiceAction = defineWorkspaceAction(
  {
    logInput: false,
    operation: "accounting.manage-post-order-invoice",
    schema: managePostOrderInvoiceSchema,
  },
  (input) =>
    Effect.gen(function* () {
      const botProtection = yield* BotProtectionService;
      yield* botProtection.verifyHuman({ verificationFailurePolicy: "deny" });
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
    }).pipe(
      Effect.provide(ReservationInvoiceService.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: m.postOrderInvoiceActionError(
              {},
              { locale: input.locale }
            ),
            cause,
          })
      )
    )
);

export const managePostOrderInvoice: typeof managePostOrderInvoiceAction =
  async (...args: Parameters<typeof managePostOrderInvoiceAction>) => {
    "use server";
    return await managePostOrderInvoiceAction(...args);
  };
