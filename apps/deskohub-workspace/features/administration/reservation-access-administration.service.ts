import { Context, Data, Effect, Layer, Match } from "effect";
import {
  WorkspacePaidFulfillmentService,
  WorkspacePaidFulfillmentServiceLiveWithDependencies,
} from "@/features/checkout/backend/fulfillment/paid-fulfillment.service";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type ReservationAccessGrant,
  ReservationAccessService,
} from "@/features/reservation-access";

export type ReservationAccessAdministrationMutation =
  | {
      readonly kind: "retry-failed";
      readonly reservationId: WorkspaceReservationId;
    }
  | {
      readonly kind: "confirm-provider-credential-removed";
      readonly providerCredentialRemoved: true;
      readonly reservationId: WorkspaceReservationId;
    };

export class ReservationAccessAdministrationError extends Data.TaggedError(
  "ReservationAccessAdministrationError"
)<{
  readonly reason: "not_found" | "invalid_state" | "recovery_failed";
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface IReservationAccessAdministration {
  readonly mutate: (
    mutation: ReservationAccessAdministrationMutation
  ) => Effect.Effect<
    ReservationAccessGrant,
    ReservationAccessAdministrationError
  >;
}

export class ReservationAccessAdministration extends Context.Service<
  ReservationAccessAdministration,
  IReservationAccessAdministration
>()("@deskohub-workspace/administration/ReservationAccessAdministration") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const access = yield* ReservationAccessService;
      const fulfillment = yield* WorkspacePaidFulfillmentService;
      const reservations = yield* WorkspaceReservationService;

      return ReservationAccessAdministration.of({
        mutate: Effect.fn("ReservationAccessAdministration.mutate")(
          function* (mutation) {
            const grant = yield* access
              .loadGrant(mutation.reservationId)
              .pipe(mapRecoveryFailure);
            if (!grant) {
              return yield* new ReservationAccessAdministrationError({
                reason: "not_found",
                message: "The reservation access grant was not found.",
              });
            }

            yield* Match.value(mutation).pipe(
              Match.discriminatorsExhaustive("kind")({
                "retry-failed": () =>
                  grant.state === "failed"
                    ? Effect.void
                    : invalidState(
                        "Only definitively failed access can be retried."
                      ),
                "confirm-provider-credential-removed": () =>
                  grant.state === "uncertain"
                    ? access
                        .confirmProviderCredentialRemoved(
                          mutation.reservationId
                        )
                        .pipe(Effect.asVoid, mapRecoveryFailure)
                    : invalidState(
                        "Only uncertain access can be reconciled after provider removal."
                      ),
              })
            );

            const target = yield* reservations
              .getAccessTarget(mutation.reservationId)
              .pipe(mapRecoveryFailure);
            yield* access
              .issueForReservation({
                reservationId: mutation.reservationId,
                reservedFrom: target.reservedFrom,
                reservedUntil: target.reservedUntil,
              })
              .pipe(Effect.asVoid, mapRecoveryFailure);
            yield* fulfillment
              .fulfillPaidOrder({ orderId: mutation.reservationId })
              .pipe(
                Effect.catch(() =>
                  Effect.logWarning(
                    "Reservation access issued with fulfillment recovery still incomplete",
                    { reservationId: mutation.reservationId }
                  )
                )
              );

            const recovered = yield* access
              .loadGrant(mutation.reservationId)
              .pipe(mapRecoveryFailure);
            if (!recovered) {
              return yield* new ReservationAccessAdministrationError({
                reason: "recovery_failed",
                message: "Recovered reservation access could not be loaded.",
              });
            }
            return recovered;
          }
        ),
      });
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(ReservationAccessService.LiveWithDependencies),
    Layer.provide(WorkspaceReservationService.LiveWithDependencies),
    Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies)
  );
}

const invalidState = (message: string) =>
  Effect.fail(
    new ReservationAccessAdministrationError({
      reason: "invalid_state",
      message,
    })
  );

const mapRecoveryFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError(
      (cause) =>
        new ReservationAccessAdministrationError({
          reason: "recovery_failed",
          message: "Reservation access recovery failed.",
          cause,
        })
    )
  );
