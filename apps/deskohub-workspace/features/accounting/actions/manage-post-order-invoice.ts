"use server";

import { Effect } from "effect";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import { managePostOrderInvoiceSchema } from "@/features/accounting/post-order-invoice";
import { m } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { processPostOrderInvoiceRequest } from "./post-order-invoice-request";

const managePostOrderInvoiceAction = defineWorkspaceAction(
  {
    logInput: false,
    operation: "accounting.manage-post-order-invoice",
    schema: managePostOrderInvoiceSchema,
  },
  (input) =>
    processPostOrderInvoiceRequest(input).pipe(
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
