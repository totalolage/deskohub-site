import { Context, Data, Effect, Layer, Match } from "effect";
import { WorkspacePaidFulfillmentService } from "@/features/checkout/backend/fulfillment/paid-fulfillment.service";
import {
  type WorkspaceReservationDetailsError,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  isReservationAccessProvisioningStale,
  type ReservationAccessGrant,
  type ReservationAccessIssuanceError,
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
  readonly reason:
    | "not_found"
    | "invalid_state"
    | "retryable_failure"
    | "recovery_failed";
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
  readonly resumeInterruptedMutation: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    ReservationAccessGrant,
    ReservationAccessAdministrationError
  >;
}

export class ReservationAccessAdministration extends Context.Service<
  ReservationAccessAdministration,
  IReservationAccessAdministration
>()("@deskohub-workspace/administration/ReservationAccessAdministration") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const access = yield* ReservationAccessService;
      const fulfillment = yield* WorkspacePaidFulfillmentService;
      const reservations = yield* WorkspaceReservationService;

      const recover = Effect.fn("ReservationAccessAdministration.recover")(
        function* (reservationId: WorkspaceReservationId) {
          const target = yield* reservations
            .getAccessTarget(reservationId)
            .pipe(mapAccessTargetFailure);
          yield* access
            .issueForReservation({
              reservationId,
              reservedFrom: target.reservedFrom,
              reservedUntil: target.reservedUntil,
            })
            .pipe(Effect.asVoid, mapIssuanceFailure);
          yield* fulfillment
            .fulfillPaidOrder({ orderId: reservationId })
            .pipe(
              Effect.catch(() =>
                Effect.logWarning(
                  "Reservation access issued with fulfillment recovery still incomplete",
                  { reservationId }
                )
              )
            );

          const recovered = yield* access
            .loadGrant(reservationId)
            .pipe(mapRecoveryFailure);
          if (!recovered) {
            return yield* new ReservationAccessAdministrationError({
              reason: "recovery_failed",
              message: "Recovered reservation access could not be loaded.",
            });
          }
          return recovered;
        }
      );

      return ReservationAccessAdministration.of({
        mutate: Effect.fn("ReservationAccessAdministration.mutate")(
          function* (mutation) {
            const grant = yield* access
              .loadGrant(mutation.reservationId)
              .pipe(mapRetryableFailure);
            if (!grant) {
              return yield* new ReservationAccessAdministrationError({
                reason: "not_found",
                message: "The reservation access grant was not found.",
              });
            }

            if (grant.state === "issued") return grant;

            yield* Match.value(mutation).pipe(
              Match.discriminatorsExhaustive("kind")({
                "retry-failed": () =>
                  grant.state === "failed"
                    ? Effect.void
                    : invalidState(
                        "Only definitively failed access can be retried."
                      ),
                "confirm-provider-credential-removed": () =>
                  grant.state === "uncertain" ||
                  isReservationAccessProvisioningStale(grant)
                    ? Effect.void
                    : invalidState(
                        "Only ambiguous access can be reconciled after provider removal."
                      ),
              })
            );

            if (mutation.kind === "confirm-provider-credential-removed") {
              yield* access
                .confirmProviderCredentialRemoved(mutation.reservationId)
                .pipe(Effect.asVoid, mapRecoveryFailure);
            }
            return yield* recover(mutation.reservationId);
          }
        ),
        resumeInterruptedMutation: Effect.fn(
          "ReservationAccessAdministration.resumeInterruptedMutation"
        )(function* (reservationId) {
          const grant = yield* access
            .loadGrant(reservationId)
            .pipe(mapRetryableFailure);
          if (!grant) {
            return yield* new ReservationAccessAdministrationError({
              reason: "not_found",
              message: "The reservation access grant was not found.",
            });
          }
          if (grant.state === "issued") return grant;
          if (grant.state !== "failed" && grant.state !== "pending") {
            return yield* invalidState(
              "Interrupted access recovery requires operator reconciliation."
            );
          }
          return yield* recover(reservationId);
        }),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(ReservationAccessService.Live),
    Layer.provide(WorkspaceReservationService.Live),
    Layer.provide(WorkspacePaidFulfillmentService.Live)
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

const mapRetryableFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError(
      (cause) =>
        new ReservationAccessAdministrationError({
          reason: "retryable_failure",
          message: "Reservation access recovery is temporarily unavailable.",
          cause,
        })
    )
  );

const mapAccessTargetFailure = <A, R>(
  effect: Effect.Effect<A, WorkspaceReservationDetailsError, R>
) =>
  effect.pipe(
    Effect.mapError(
      (cause) =>
        new ReservationAccessAdministrationError({
          reason:
            cause.errorCode === "reservation_access_unavailable"
              ? "invalid_state"
              : "retryable_failure",
          message:
            cause.errorCode === "reservation_access_unavailable"
              ? cause.message
              : "Reservation access recovery is temporarily unavailable.",
          cause,
        })
    )
  );

const mapIssuanceFailure = <A, R>(
  effect: Effect.Effect<A, ReservationAccessIssuanceError, R>
) =>
  effect.pipe(
    Effect.mapError(
      (cause) =>
        new ReservationAccessAdministrationError({
          reason:
            cause.outcome === "rejected" ? "invalid_state" : "recovery_failed",
          message: cause.message,
          cause,
        })
    )
  );
