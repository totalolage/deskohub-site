import {
  IgloohomeDeviceIdSchema,
  type IgloohomeRequestError,
  IgloohomeService,
} from "@deskohub/igloohome";
import { Context, Data, Effect, Layer, Match, Option, Schema } from "effect";
import { env } from "@/env";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceIgloohomeLayer } from "@/shared/backend/config/igloohome.config";
import type {
  IssuedReservationAccess,
  ReservationAccessGrant,
} from "../reservation-access";
import {
  makeReservationAccessName,
  reservationAccessProvisioningStaleAfterMilliseconds,
} from "../reservation-access";
import {
  getIgloohomeAccessWindow,
  isSameIgloohomeAccessWindow,
} from "./igloohome-access-window";
import {
  ReservationAccessRepository,
  type ReservationAccessStorageError,
} from "./reservation-access.repository";

export type ReservationAccessIssuanceOutcome = "rejected" | "uncertain";

export class ReservationAccessIssuanceError extends Data.TaggedError(
  "ReservationAccessIssuanceError"
)<{
  readonly reservationId: WorkspaceReservationId;
  readonly outcome: ReservationAccessIssuanceOutcome;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * The access a reservation's door code grants. Workspace records the exact
 * span the reservation holds; the Igloohome window is the whole-hour span the
 * lock is programmed with, which only the provider request uses.
 */
export interface ReservationAccessInterval {
  readonly scheduledStartsAt: Temporal.Instant;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly providerStartsAt: string;
  readonly providerEndsAt: string;
}

export const getReservationAccessInterval = (input: {
  readonly reservationId: WorkspaceReservationId;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
  readonly now?: Temporal.Instant;
}): Effect.Effect<ReservationAccessInterval, ReservationAccessIssuanceError> =>
  Effect.gen(function* () {
    const now = input.now ?? Temporal.Now.instant();

    if (Temporal.Instant.compare(now, input.reservedUntil) >= 0) {
      return yield* new ReservationAccessIssuanceError({
        reservationId: input.reservationId,
        outcome: "rejected",
        message: "AlgoPIN access cannot be issued after the reservation ends.",
      });
    }

    const window = getIgloohomeAccessWindow({
      startsAt: input.reservedFrom,
      endsAt: input.reservedUntil,
      now,
    });
    if (Option.isNone(window)) {
      return yield* new ReservationAccessIssuanceError({
        reservationId: input.reservationId,
        outcome: "rejected",
        message: "Reservation cannot be represented by a 1–672 hour AlgoPIN.",
      });
    }

    return {
      scheduledStartsAt: input.reservedFrom,
      startsAt: input.reservedFrom,
      endsAt: input.reservedUntil,
      providerStartsAt: window.value.startsAt,
      providerEndsAt: window.value.endsAt,
    };
  });

const hasReservationAccessBounds = (
  grant: ReservationAccessGrant,
  bounds: Pick<
    ReservationAccessGrant,
    "scheduledAccessStartsAt" | "accessStartsAt" | "accessEndsAt"
  >
) =>
  grant.scheduledAccessStartsAt.equals(bounds.scheduledAccessStartsAt) &&
  grant.accessStartsAt.equals(bounds.accessStartsAt) &&
  grant.accessEndsAt.equals(bounds.accessEndsAt);

export interface IReservationAccessService {
  readonly loadGrant: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    ReservationAccessGrant | null,
    ReservationAccessIssuanceError
  >;
  readonly confirmProviderCredentialRemoved: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<ReservationAccessGrant, ReservationAccessIssuanceError>;
  readonly issueForReservation: (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly reservedFrom: Temporal.Instant;
    readonly reservedUntil: Temporal.Instant;
  }) => Effect.Effect<IssuedReservationAccess, ReservationAccessIssuanceError>;
}

export class ReservationAccessService extends Context.Service<
  ReservationAccessService,
  IReservationAccessService
>()("@deskohub-workspace/reservation-access/ReservationAccessService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const repository = yield* ReservationAccessRepository;
      const igloohome = yield* IgloohomeService;
      const deviceId = Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
        env.IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID
      );

      return ReservationAccessService.of({
        loadGrant: (reservationId) =>
          repository.findByReservationId(reservationId).pipe(
            Effect.mapError(
              (cause) =>
                new ReservationAccessIssuanceError({
                  reservationId,
                  outcome: "rejected",
                  message: "Reservation access grant could not be loaded.",
                  cause,
                })
            )
          ),
        confirmProviderCredentialRemoved: (reservationId) => {
          const reconciledAt = Temporal.Now.instant();
          return repository
            .reconcileUncertain({
              reservationId,
              reconciledAt,
              provisioningStaleBefore: reconciledAt.subtract({
                milliseconds:
                  reservationAccessProvisioningStaleAfterMilliseconds,
              }),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ReservationAccessIssuanceError({
                    reservationId,
                    outcome: "rejected",
                    message:
                      "Reservation access is not awaiting provider reconciliation.",
                    cause,
                  })
              )
            );
        },
        issueForReservation: Effect.fn(
          "ReservationAccessService.issueForReservation"
        )(function* (input) {
          const existingGrant = yield* repository
            .findByReservationId(input.reservationId)
            .pipe(
              Effect.mapError(
                () =>
                  new ReservationAccessIssuanceError({
                    reservationId: input.reservationId,
                    outcome: "rejected",
                    message: "Reservation access grant could not be loaded.",
                  })
              )
            );
          if (existingGrant?.state === "issued") {
            if (existingGrant.deviceId !== deviceId) {
              yield* repository
                .markUncertain({
                  id: existingGrant.id,
                  reservationId: input.reservationId,
                  failureCode: "reservation_access_device_changed",
                  failedAt: Temporal.Now.instant(),
                })
                .pipe(
                  Effect.mapError(
                    () =>
                      new ReservationAccessIssuanceError({
                        reservationId: input.reservationId,
                        outcome: "uncertain",
                        message:
                          "Changed reservation access could not be reconciled.",
                      })
                  )
                );
              return yield* new ReservationAccessIssuanceError({
                reservationId: input.reservationId,
                outcome: "uncertain",
                message: "Reservation access device changed after issuance.",
              });
            }
            // Grants issued before Workspace recorded exact spans hold the
            // whole hours they were programmed with, which compare the same
            // and take the exact span when reused.
            if (
              isSameIgloohomeAccessWindow(
                {
                  startsAt: existingGrant.scheduledAccessStartsAt,
                  endsAt: existingGrant.accessEndsAt,
                },
                { startsAt: input.reservedFrom, endsAt: input.reservedUntil }
              )
            ) {
              // A Dotypos timing change within the same hours keeps the PIN,
              // and the grant records the span the reservation now holds.
              const bounds = {
                scheduledAccessStartsAt: input.reservedFrom,
                accessStartsAt: input.reservedFrom,
                accessEndsAt: input.reservedUntil,
              };
              const grant = hasReservationAccessBounds(existingGrant, bounds)
                ? existingGrant
                : yield* repository
                    .rescheduleIssued({
                      id: existingGrant.id,
                      reservationId: input.reservationId,
                      from: existingGrant,
                      to: bounds,
                      rescheduledAt: Temporal.Now.instant(),
                    })
                    .pipe(
                      Effect.mapError(
                        () =>
                          new ReservationAccessIssuanceError({
                            reservationId: input.reservationId,
                            outcome: "rejected",
                            message:
                              "Rescheduled reservation access could not be recorded.",
                          })
                      ),
                      Effect.flatMap((rescheduled) =>
                        rescheduled
                          ? Effect.succeed(rescheduled)
                          : Effect.fail(
                              new ReservationAccessIssuanceError({
                                reservationId: input.reservationId,
                                outcome: "rejected",
                                message:
                                  "Reservation access grant changed concurrently.",
                              })
                            )
                      )
                    );
              const accessCode = yield* repository
                .loadIssuedCode({
                  id: grant.id,
                  reservationId: input.reservationId,
                })
                .pipe(
                  Effect.mapError(
                    () =>
                      new ReservationAccessIssuanceError({
                        reservationId: input.reservationId,
                        outcome: "rejected",
                        message:
                          "Issued reservation access could not be recovered.",
                      })
                  )
                );
              return {
                grantId: grant.id,
                accessCode,
                accessStartsAt: grant.accessStartsAt,
                accessEndsAt: grant.accessEndsAt,
              };
            }
          }

          const interval = yield* getReservationAccessInterval(input);
          const grant = yield* repository
            .ensure({
              reservationId: input.reservationId,
              deviceId,
              scheduledAccessStartsAt: interval.scheduledStartsAt,
              accessStartsAt: interval.startsAt,
              accessEndsAt: interval.endsAt,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new ReservationAccessIssuanceError({
                    reservationId: input.reservationId,
                    outcome: "rejected",
                    message: "Reservation access grant could not be prepared.",
                  })
              )
            );

          if (grant.state === "issued") {
            const accessCode = yield* repository
              .loadIssuedCode({
                id: grant.id,
                reservationId: input.reservationId,
              })
              .pipe(
                Effect.mapError(
                  () =>
                    new ReservationAccessIssuanceError({
                      reservationId: input.reservationId,
                      outcome: "rejected",
                      message:
                        "Issued reservation access could not be recovered.",
                    })
                )
              );
            return {
              grantId: grant.id,
              accessCode,
              accessStartsAt: grant.accessStartsAt,
              accessEndsAt: grant.accessEndsAt,
            };
          }

          if (grant.state === "uncertain") {
            return yield* new ReservationAccessIssuanceError({
              reservationId: input.reservationId,
              outcome: "uncertain",
              message:
                "Reservation access issuance requires operator reconciliation.",
            });
          }

          if (grant.state === "provisioning") {
            const staleBefore = Temporal.Now.instant().subtract({
              milliseconds: reservationAccessProvisioningStaleAfterMilliseconds,
            });
            if (
              grant.provisioningStartedAt &&
              Temporal.Instant.compare(
                grant.provisioningStartedAt,
                staleBefore
              ) <= 0
            ) {
              yield* repository
                .markUncertain({
                  id: grant.id,
                  reservationId: input.reservationId,
                  failureCode: "stale_provisioning",
                  failedAt: Temporal.Now.instant(),
                })
                .pipe(Effect.ignore);
            }
            return yield* new ReservationAccessIssuanceError({
              reservationId: input.reservationId,
              outcome: "uncertain",
              message:
                "Reservation access issuance is in progress or has an unknown outcome.",
            });
          }

          const claimedAt = Temporal.Now.instant();
          // Claiming records the name before the request, so an operator can
          // find a credential whose issuance outcome is unknown.
          const accessName = makeReservationAccessName(grant.id);
          const claimed = yield* repository
            .claim({
              id: grant.id,
              reservationId: input.reservationId,
              accessName,
              startedAt: claimedAt,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new ReservationAccessIssuanceError({
                    reservationId: input.reservationId,
                    outcome: "rejected",
                    message: "Reservation access grant could not be claimed.",
                  })
              )
            );
          if (!claimed) {
            return yield* new ReservationAccessIssuanceError({
              reservationId: input.reservationId,
              outcome: "uncertain",
              message: "Reservation access grant was claimed concurrently.",
            });
          }

          const issued = yield* igloohome
            .issueHourlyAlgoPin({
              deviceId,
              variance: 1,
              startsAt: interval.providerStartsAt,
              endsAt: interval.providerEndsAt,
              accessName,
            })
            .pipe(
              Effect.catch(
                Effect.fn(function* (error: IgloohomeRequestError) {
                  const failedAt = Temporal.Now.instant();
                  const failure = Match.value(error.outcome).pipe(
                    Match.when("ambiguous", () => ({
                      record: repository.markUncertain({
                        id: grant.id,
                        reservationId: input.reservationId,
                        failureCode: "provider_outcome_ambiguous",
                        failedAt,
                      }),
                      error: new ReservationAccessIssuanceError({
                        reservationId: input.reservationId,
                        outcome: "uncertain",
                        message:
                          "Igloohome AlgoPIN issuance outcome is uncertain.",
                      }),
                    })),
                    Match.when("rejected", () => ({
                      record: repository.markFailed({
                        id: grant.id,
                        reservationId: input.reservationId,
                        failureCode: "provider_request_rejected",
                        failedAt,
                      }),
                      error: new ReservationAccessIssuanceError({
                        reservationId: input.reservationId,
                        outcome: "rejected",
                        message: "Igloohome rejected AlgoPIN issuance.",
                      }),
                    })),
                    Match.exhaustive
                  );
                  yield* failure.record.pipe(Effect.ignore);
                  return yield* failure.error;
                })
              )
            );

          const issuedAt = Temporal.Now.instant();
          yield* repository
            .markIssued({
              id: grant.id,
              reservationId: input.reservationId,
              accessCode: issued.pin,
              pinId: issued.pinId,
              issuedAt,
            })
            .pipe(
              Effect.catch((_: ReservationAccessStorageError) =>
                repository
                  .markUncertain({
                    id: grant.id,
                    reservationId: input.reservationId,
                    failureCode: "issued_credential_storage_failed",
                    failedAt: Temporal.Now.instant(),
                  })
                  .pipe(
                    Effect.ignore,
                    Effect.andThen(
                      Effect.fail(
                        new ReservationAccessIssuanceError({
                          reservationId: input.reservationId,
                          outcome: "uncertain",
                          message:
                            "Issued AlgoPIN could not be durably stored.",
                        })
                      )
                    )
                  )
              )
            );

          return {
            grantId: grant.id,
            accessCode: issued.pin,
            accessStartsAt: interval.startsAt,
            accessEndsAt: interval.endsAt,
          };
        }),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(ReservationAccessRepository.Live),
    Layer.provide(WorkspaceIgloohomeLayer)
  );
}
