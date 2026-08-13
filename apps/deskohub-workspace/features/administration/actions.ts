"use server";

import { AdministrationWorkspaceReservationId } from "@deskohub/workspace-admin-api";
import { Effect, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { AdministrationLive } from "./administration.runtime";
import { AdministrationService } from "./administration.service";
import {
  type ReservationLookupInput,
  reservationLookupStandardSchema,
} from "./contracts";
import {
  ReservationAccessAdministration,
  ReservationAccessAdministrationError,
} from "./reservation-access-administration.service";

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

const reservationAccessMutationSchema = Schema.toStandardSchemaV1(
  Schema.Union([
    Schema.Struct({
      reservationId: AdministrationWorkspaceReservationId,
      kind: Schema.Literal("retry-failed"),
    }),
    Schema.Struct({
      reservationId: AdministrationWorkspaceReservationId,
      kind: Schema.Literal("confirm-provider-credential-removed"),
      providerCredentialRemoved: Schema.Literal(true),
    }),
  ])
);

const mutateReservationAccessAction = defineWorkspaceAction(
  {
    operation: "administration.mutate-reservation-access",
    schema: reservationAccessMutationSchema,
  },
  (input) =>
    requireDiscountAdminAuthorization().pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const administration = yield* ReservationAccessAdministration;
          const grant = yield* administration.mutate(input);
          yield* Effect.sync(() =>
            revalidatePath(`/admin/reservations/${input.reservationId}`)
          );
          return {
            grantState: grant.state,
            notice: "Reservation access recovery completed.",
          };
        })
      ),
      Effect.provide(ReservationAccessAdministration.LiveWithDependencies),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message:
              cause instanceof ReservationAccessAdministrationError
                ? cause.message
                : "Reservation access recovery could not be completed.",
            cause,
          })
      )
    )
);

export const mutateReservationAccess: typeof mutateReservationAccessAction =
  async (...args: Parameters<typeof mutateReservationAccessAction>) => {
    "use server";
    return await mutateReservationAccessAction(...args);
  };
