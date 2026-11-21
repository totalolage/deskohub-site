"use server";

import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { env } from "@/env";
import {
  CustomerAccountContactService,
  CustomerAccountSections,
} from "@/features/account";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { m } from "@/features/i18n";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { CoworkPassesReleaseGate } from "@/features/passes/backend/cowork-passes-release-gate";
import { EntryPackUnavailableError } from "@/features/passes/backend/entry-pack-redemption";
import { ReferralService } from "@/features/referrals";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { OvernightStayReleaseGate } from "@/features/reservation/backend/overnight-stay-release-gate";
import {
  prepareWorkspacePayState,
  ReservationBooking,
} from "@/features/reservation/backend/reservation-booking.service";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { preparePayStateSchema } from "./prepare-pay-state.schema";
import { getPreparePayStateDeadline } from "./prepare-pay-state-deadline";
import {
  toReservationFormError,
  verifyReservationFormHuman,
} from "./prepare-pay-state-form";

const preparePayStateAction = defineWorkspaceAction(
  {
    logInput: false,
    operation: "checkout.prepare-pay-state",
    deadline: getPreparePayStateDeadline(env.VERCEL_ENV),
    schema: preparePayStateSchema,
  },
  (input) =>
    verifyReservationFormHuman(input.locale).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          if (input.entryPackId && !(yield* CoworkPassesReleaseGate.isOpen)) {
            return yield* new EntryPackUnavailableError({});
          }
          return yield* prepareWorkspacePayState(input);
        }).pipe(
          Effect.catchTag("EntryPackUnavailableError", () =>
            Effect.succeed({
              status: "error" as const,
              reason: "entry_pack_unavailable" as const,
              message: m.reservationErrorMessage({}, { locale: input.locale }),
            })
          ),
          Effect.mapError(toReservationFormError(input))
        )
      ),
      Effect.provide(
        RememberedReferral.Cookies.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              ReservationBooking.Live,
              ReferralService.Live,
              CustomerAccountSections.Live,
              CurrentCustomerAccount.Live,
              CustomerAccountContactService.Live
            )
          ),
          Layer.provideMerge(
            Layer.mergeAll(
              ReferralReleaseGateRequest,
              CoworkPassesReleaseGate.Live,
              OfficeReleaseGate.Live,
              OvernightStayReleaseGate.Live
            )
          ),
          Layer.provide(WorkspaceDatabase.Default)
        )
      )
    )
);

export const preparePayState: typeof preparePayStateAction = async (
  ...args: Parameters<typeof preparePayStateAction>
) => {
  "use server";
  return await preparePayStateAction(...args);
};
