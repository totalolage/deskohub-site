import {
  IgloohomeDeviceIdSchema,
  type IgloohomeRequestError,
  IgloohomeService,
} from "@deskohub/igloohome";
import { Context, Data, Effect, Layer, Match, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import type { ReservationAccessGrantRow } from "@/db/schema";
import { env } from "@/env";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { IgloohomeServiceLive } from "@/shared/backend/config/igloohome.config";
import { workspaceSiteConstants } from "@/shared/utils";
import { ceilToWholeHour, floorToWholeHour } from "@/shared/utils/temporal";
import type {
  IssuedReservationAccess,
  ReservationAccessGrant,
} from "../reservation-access";
import {
  ReservationAccessRepository,
  ReservationAccessRepositoryLive,
  type ReservationAccessStorageError,
} from "./reservation-access.repository";

export const RESERVATION_ACCESS_PROVISIONING_STALE_AFTER_MS = 60_000;
const maximumHourlyAlgoPinDurationHours = 672;

export type ReservationAccessIssuanceOutcome = "rejected" | "uncertain";

export class ReservationAccessIssuanceError extends Data.TaggedError(
  "ReservationAccessIssuanceError"
)<{
  readonly reservationId: WorkspaceReservationId;
  readonly outcome: ReservationAccessIssuanceOutcome;
  readonly message: string;
  readonly cause?: unknown;
}> {}

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
    const schedule = getReservationAccessSchedule(input);

    if (Temporal.Instant.compare(now, input.reservedUntil) >= 0) {
      return yield* new ReservationAccessIssuanceError({
        reservationId: input.reservationId,
        outcome: "rejected",
        message: "AlgoPIN access cannot be issued after the reservation ends.",
      });
    }

    const currentHour = floorToWholeHour(
      now.toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    );
    const accessStart =
      Temporal.ZonedDateTime.compare(schedule.startsAt, currentHour) >= 0
        ? schedule.startsAt
        : currentHour;
    const accessStartsAt = accessStart.toInstant();
    const accessEndsAt = schedule.endsAt.toInstant();
    const durationHours =
      (accessEndsAt.epochMilliseconds - accessStartsAt.epochMilliseconds) /
      3_600_000;

    if (
      !Number.isInteger(durationHours) ||
      durationHours < 1 ||
      durationHours > maximumHourlyAlgoPinDurationHours
    ) {
      return yield* new ReservationAccessIssuanceError({
        reservationId: input.reservationId,
        outcome: "rejected",
        message: "Reservation cannot be represented by a 1–672 hour AlgoPIN.",
      });
    }

    return {
      scheduledStartsAt: schedule.startsAt.toInstant(),
      startsAt: accessStartsAt,
      endsAt: accessEndsAt,
      providerStartsAt: accessStart.toString({
        smallestUnit: "second",
        timeZoneName: "never",
      }),
      providerEndsAt: schedule.endsAt.toString({
        smallestUnit: "second",
        timeZoneName: "never",
      }),
    };
  });

const getReservationAccessSchedule = (input: {
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
}) => {
  const timeZone = workspaceSiteConstants.location.timeZone;
  return {
    startsAt: floorToWholeHour(input.reservedFrom.toZonedDateTimeISO(timeZone)),
    endsAt: ceilToWholeHour(input.reservedUntil.toZonedDateTimeISO(timeZone)),
  };
};

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
  readonly clearExpiredAccessCodes: (
    now: Temporal.Instant
  ) => Effect.Effect<number, ReservationAccessStorageError>;
}

export class ReservationAccessService extends Context.Service<
  ReservationAccessService,
  IReservationAccessService
>()("@deskohub-workspace/reservation-access/ReservationAccessService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const repository = yield* ReservationAccessRepository;
      const igloohome = yield* IgloohomeService;
      const deviceId = Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
        env.IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID
      );

      return ReservationAccessService.of({
        clearExpiredAccessCodes: repository.clearExpiredAccessCodes,
        loadGrant: (reservationId) =>
          repository.findByReservationId(reservationId).pipe(
            Effect.map((grant) =>
              grant ? toReservationAccessGrant(grant) : null
            ),
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
        confirmProviderCredentialRemoved: (reservationId) =>
          repository
            .reconcileUncertain({
              reservationId,
              reconciledAt: Temporal.Now.instant(),
            })
            .pipe(
              Effect.map(toReservationAccessGrant),
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
            ),
        issueForReservation: Effect.fn(
          "ReservationAccessService.issueForReservation"
        )(function* (input) {
          const schedule = getReservationAccessSchedule(input);
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
            if (
              existingGrant.deviceId !== deviceId ||
              !existingGrant.scheduledAccessStartsAt.equals(
                schedule.startsAt.toInstant()
              ) ||
              !existingGrant.accessEndsAt.equals(schedule.endsAt.toInstant())
            ) {
              yield* repository
                .markUncertain({
                  id: existingGrant.id,
                  reservationId: input.reservationId,
                  failureCode: "reservation_access_changed",
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
                message: "Reservation access changed after AlgoPIN issuance.",
              });
            }
            const accessCode = yield* repository
              .loadIssuedCode({
                id: existingGrant.id,
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
              grantId: existingGrant.id,
              accessCode,
              accessStartsAt: existingGrant.accessStartsAt,
              accessEndsAt: existingGrant.accessEndsAt,
            };
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
              milliseconds: RESERVATION_ACCESS_PROVISIONING_STALE_AFTER_MS,
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
          const claimed = yield* repository
            .claim({
              id: grant.id,
              reservationId: input.reservationId,
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
              startsAt: interval.providerStartsAt,
              endsAt: interval.providerEndsAt,
              accessName: `Deskohub ${input.reservationId}`.slice(0, 60),
            })
            .pipe(
              Effect.catch((error: IgloohomeRequestError) =>
                Effect.gen(function* () {
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

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(ReservationAccessRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(IgloohomeServiceLive)
  );
}

const toReservationAccessGrant = (
  grant: ReservationAccessGrantRow
): ReservationAccessGrant => ({
  id: grant.id,
  reservationId: grant.workspaceReservationId,
  provider: grant.provider,
  credentialType: grant.credentialType,
  deviceId: grant.deviceId,
  state: grant.state,
  providerCredentialId: grant.providerCredentialId,
  scheduledAccessStartsAt: grant.scheduledAccessStartsAt,
  accessStartsAt: grant.accessStartsAt,
  accessEndsAt: grant.accessEndsAt,
  provisioningStartedAt: grant.provisioningStartedAt,
  issuedAt: grant.issuedAt,
  failedAt: grant.failedAt,
  failureCode: grant.failureCode,
  createdAt: grant.createdAt,
  updatedAt: grant.updatedAt,
});
