"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { AdministrationLive } from "./administration.runtime";
import { AdministrationService } from "./administration.service";
import {
  type ReservationCancellationInput,
  type ReservationLookupInput,
  reservationCancellationStandardSchema,
  reservationLookupStandardSchema,
} from "./contracts";
import {
  ReservationAdministrationError,
  ReservationAdministrationService,
} from "./reservation-administration.service";

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

const cancelAdministrationReservationAction = defineWorkspaceAction(
  {
    operation: "administration.cancel-reservation",
    schema: reservationCancellationStandardSchema,
  },
  (input: ReservationCancellationInput) =>
    requireDiscountAdminAuthorization().pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const administration = yield* ReservationAdministrationService;
          const result = yield* administration.cancel(input);
          yield* Effect.sync(() =>
            revalidatePath(`/admin/reservations/${input.reservationId}`)
          );
          return result;
        })
      ),
      Effect.provide(ReservationAdministrationService.LiveWithDependencies),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message:
              cause instanceof ReservationAdministrationError
                ? cause.message
                : "The reservation could not be cancelled.",
            cause,
          })
      )
    )
);

export const cancelAdministrationReservation: typeof cancelAdministrationReservationAction =
  async (...args: Parameters<typeof cancelAdministrationReservationAction>) => {
    "use server";
    return await cancelAdministrationReservationAction(...args);
  };
