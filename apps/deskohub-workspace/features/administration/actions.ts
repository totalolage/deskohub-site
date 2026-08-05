"use server";

import { Effect } from "effect";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { AdministrationLive } from "./administration.runtime";
import { AdministrationService } from "./administration.service";
import {
  type ReservationLookupInput,
  reservationLookupStandardSchema,
} from "./contracts";

const findReservation = Effect.fn("AdministrationService.findReservation")(
  (input: ReservationLookupInput) =>
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return {
        reservationId: yield* administration.findReservationId(
          input.identifier
        ),
      };
    })
);

const getAdministrationReservationAction = defineWorkspaceAction(
  {
    operation: "administration.get-reservation",
    schema: reservationLookupStandardSchema,
    logInput: false,
  },
  (input) =>
    requireDiscountAdminAuthorization().pipe(
      Effect.andThen(findReservation(input)),
      Effect.provide(AdministrationLive),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: "The reservation lookup is temporarily unavailable.",
            cause: cause instanceof Error ? cause : undefined,
          })
      )
    )
);

export const getAdministrationReservation: typeof getAdministrationReservationAction =
  async (...args: Parameters<typeof getAdministrationReservationAction>) => {
    "use server";
    return await getAdministrationReservationAction(...args);
  };
