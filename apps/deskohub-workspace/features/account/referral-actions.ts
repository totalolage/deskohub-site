"use server";

import { Effect, Layer, Schema } from "effect";
import {
  accountActionError,
  requireAccountsEnabled,
  requireVerifiedSession,
} from "@/features/account/account-action-guards";
import { resolveCurrentCustomerAccount } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { acceptReferralForAccount } from "@/features/account/referral-acceptance";
import type { Locale } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const acceptAccountReferralInputSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ code: Schema.String }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

const acceptAccountReferralForCurrentCustomer = Effect.fn(
  "acceptAccountReferralForCurrentCustomer"
)(function* (code: string, locale: Locale) {
  yield* requireAccountsEnabled(locale);
  const botProtection = yield* BotProtectionService;
  yield* botProtection.verifyHuman({ verificationFailurePolicy: "deny" });
  yield* requireVerifiedSession;

  const account = yield* resolveCurrentCustomerAccount;
  const referrals = yield* ReferralService;
  return yield* acceptReferralForAccount(
    code,
    account,
    referrals.acceptReferral
  );
});

const acceptAccountReferralAction = defineWorkspaceAction(
  {
    operation: "account.accept-referral",
    schema: acceptAccountReferralInputSchema,
    logInput: false,
  },
  (input, { locale }) =>
    acceptAccountReferralForCurrentCustomer(input.code, locale).pipe(
      Effect.catchTag("CustomerAccountAccessError", (error) =>
        Effect.fail(accountActionError(locale)(error))
      ),
      Effect.provide(
        Layer.mergeAll(CustomerAuthentication.Default, ReferralService.Live)
      )
    )
);

export const acceptAccountReferral: typeof acceptAccountReferralAction = async (
  ...args: Parameters<typeof acceptAccountReferralAction>
) => {
  "use server";
  return await acceptAccountReferralAction(...args);
};
