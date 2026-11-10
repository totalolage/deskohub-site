"use server";

import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { env } from "@/env";
import {
  CustomerAccountContactService,
  CustomerAccountSections,
} from "@/features/account";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralService } from "@/features/referrals";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
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
        prepareWorkspacePayState(input).pipe(
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
            Layer.mergeAll(ReferralReleaseGateRequest, OfficeReleaseGate.Live)
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
