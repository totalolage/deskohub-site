"use server";

import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountSections } from "@/features/account/backend/customer-account-sections";
import { type Locale, locales } from "@/features/i18n";
import { type OrderId, orderIdSchema } from "@/features/order";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { CoworkPassesReleaseGate } from "./backend/cowork-passes-release-gate";
import { requestEntryPackGiftResend } from "./backend/entry-pack-gift-resend";

const resendAction = defineWorkspaceAction(
  {
    operation: "passes.resend-entry-pack-invitation",
    schema: Schema.toStandardSchemaV1(
      Schema.Struct({
        orderId: orderIdSchema,
        locale: Schema.Literals(locales),
      })
    ),
    logInput: false,
  },
  ({ orderId }) =>
    requestEntryPackGiftResend(orderId).pipe(
      Effect.provide(
        Layer.mergeAll(
          CoworkPassesReleaseGate.Live,
          CurrentCustomerAccount.Live,
          CustomerAccountSections.Live,
          WorkspaceDatabase.Default
        )
      )
    )
);

export async function resendEntryPackInvitation(
  orderId: OrderId,
  locale: Locale
): Promise<"queued" | "unavailable"> {
  const result = await resendAction({ orderId, locale });
  return result?.data ?? "unavailable";
}
