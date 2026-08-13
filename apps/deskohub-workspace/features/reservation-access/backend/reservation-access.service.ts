import {
  IgloohomeDeviceIdSchema,
  type IgloohomeRequestError,
  IgloohomeService,
} from "@deskohub/igloohome";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import { env } from "@/env";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { IgloohomeServiceLive } from "@/shared/backend/config/igloohome.config";
import { workspaceSiteConstants } from "@/shared/utils";
import type { IssuedReservationAccess } from "../reservation-access";
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
}> {}

export interface ReservationAccessInterval {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly providerStartsAt: string;
  readonly providerEndsAt: string;
}

const isWholeHour = (value: Temporal.ZonedDateTime) =>
  value.minute === 0 &&
  value.second === 0 &&
  value.millisecond === 0 &&
  value.microsecond === 0 &&
  value.nanosecond === 0;

const floorToWholeHour = (value: Temporal.ZonedDateTime) =>
  value.with({
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });

const formatProviderDateTime = (value: Temporal.ZonedDateTime) =>
  value.toString({ smallestUnit: "second", timeZoneName: "never" });

export const getReservationAccessInterval = (input: {
  readonly reservationId: WorkspaceReservationId;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
  readonly now?: Temporal.Instant;
}): Effect.Effect<ReservationAccessInterval, ReservationAccessIssuanceError> =>
  Effect.gen(function* () {
    const timeZone = workspaceSiteConstants.location.timeZone;
    const now = input.now ?? Temporal.Now.instant();
    const reservationStart = input.reservedFrom.toZonedDateTimeISO(timeZone);
    const reservationEnd = input.reservedUntil.toZonedDateTimeISO(timeZone);

    if (!isWholeHour(reservationStart) || !isWholeHour(reservationEnd)) {
      return yield* new ReservationAccessIssuanceError({
        reservationId: input.reservationId,
        outcome: "rejected",
        message: "AlgoPIN access requires whole-hour reservation boundaries.",
      });
    }

    const currentHour = floorToWholeHour(now.toZonedDateTimeISO(timeZone));
    const accessStart =
      Temporal.ZonedDateTime.compare(reservationStart, currentHour) >= 0
        ? reservationStart
        : currentHour;
    const accessStartsAt = accessStart.toInstant();
    const accessEndsAt = reservationEnd.toInstant();
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
      startsAt: accessStartsAt,
      endsAt: accessEndsAt,
      providerStartsAt: formatProviderDateTime(accessStart),
      providerEndsAt: formatProviderDateTime(reservationEnd),
    };
  });

const issuanceError = (
  reservationId: WorkspaceReservationId,
  outcome: ReservationAccessIssuanceOutcome,
  message: string
) => new ReservationAccessIssuanceError({ reservationId, outcome, message });

export interface IReservationAccessService {
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
        env.IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID ?? "fixture-ek1"
      );

      return ReservationAccessService.of({
        clearExpiredAccessCodes: repository.clearExpiredAccessCodes,
        issueForReservation: Effect.fn(
          "ReservationAccessService.issueForReservation"
        )(function* (input) {
          const existingGrant = yield* repository
            .findByReservationId(input.reservationId)
            .pipe(
              Effect.mapError(() =>
                issuanceError(
                  input.reservationId,
                  "rejected",
                  "Reservation access grant could not be loaded."
                )
              )
            );
          if (existingGrant?.state === "issued") {
            if (
              !existingGrant.reservationStartsAt.equals(input.reservedFrom) ||
              !existingGrant.accessEndsAt.equals(input.reservedUntil)
            ) {
              yield* repository
                .markUncertain({
                  id: existingGrant.id,
                  reservationId: input.reservationId,
                  failureCode: "reservation_timing_changed",
                  failedAt: Temporal.Now.instant(),
                })
                .pipe(
                  Effect.mapError(() =>
                    issuanceError(
                      input.reservationId,
                      "uncertain",
                      "Changed reservation access could not be reconciled."
                    )
                  )
                );
              return yield* issuanceError(
                input.reservationId,
                "uncertain",
                "Reservation timing changed after AlgoPIN issuance."
              );
            }
            const accessCode = yield* repository
              .loadIssuedCode({
                id: existingGrant.id,
                reservationId: input.reservationId,
              })
              .pipe(
                Effect.mapError(() =>
                  issuanceError(
                    input.reservationId,
                    "rejected",
                    "Issued reservation access could not be recovered."
                  )
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
              reservationStartsAt: input.reservedFrom,
              accessStartsAt: interval.startsAt,
              accessEndsAt: interval.endsAt,
            })
            .pipe(
              Effect.mapError(() =>
                issuanceError(
                  input.reservationId,
                  "rejected",
                  "Reservation access grant could not be prepared."
                )
              )
            );

          if (grant.state === "issued") {
            const accessCode = yield* repository
              .loadIssuedCode({
                id: grant.id,
                reservationId: input.reservationId,
              })
              .pipe(
                Effect.mapError(() =>
                  issuanceError(
                    input.reservationId,
                    "rejected",
                    "Issued reservation access could not be recovered."
                  )
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
            return yield* issuanceError(
              input.reservationId,
              "uncertain",
              "Reservation access issuance requires operator reconciliation."
            );
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
            return yield* issuanceError(
              input.reservationId,
              "uncertain",
              "Reservation access issuance is in progress or has an unknown outcome."
            );
          }

          const claimedAt = Temporal.Now.instant();
          const claimed = yield* repository
            .claim({
              id: grant.id,
              reservationId: input.reservationId,
              startedAt: claimedAt,
            })
            .pipe(
              Effect.mapError(() =>
                issuanceError(
                  input.reservationId,
                  "rejected",
                  "Reservation access grant could not be claimed."
                )
              )
            );
          if (!claimed) {
            return yield* issuanceError(
              input.reservationId,
              "uncertain",
              "Reservation access grant was claimed concurrently."
            );
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
                  const outcome = error.outcome;
                  const failedAt = Temporal.Now.instant();
                  const recordFailure =
                    outcome === "ambiguous"
                      ? repository.markUncertain({
                          id: grant.id,
                          reservationId: input.reservationId,
                          failureCode: "provider_outcome_ambiguous",
                          failedAt,
                        })
                      : repository.markFailed({
                          id: grant.id,
                          reservationId: input.reservationId,
                          failureCode: "provider_request_rejected",
                          failedAt,
                        });
                  yield* recordFailure.pipe(Effect.ignore);
                  return yield* issuanceError(
                    input.reservationId,
                    outcome === "ambiguous" ? "uncertain" : "rejected",
                    outcome === "ambiguous"
                      ? "Igloohome AlgoPIN issuance outcome is uncertain."
                      : "Igloohome rejected AlgoPIN issuance."
                  );
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
                        issuanceError(
                          input.reservationId,
                          "uncertain",
                          "Issued AlgoPIN could not be durably stored."
                        )
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
