import type {
  AlgoPin,
  IgloohomeDeviceId,
  IgloohomePinId,
} from "@deskohub/igloohome";
import { AlgoPinSchema } from "@deskohub/igloohome";
import { and, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type ReservationAccessGrantRow,
  reservationAccessGrants,
} from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import type {
  ReservationAccessGrant,
  ReservationAccessGrantId,
} from "../reservation-access";

export class ReservationAccessStorageError extends Data.TaggedError(
  "ReservationAccessStorageError"
)<{
  readonly operation:
    | "claim"
    | "clear_expired"
    | "ensure"
    | "load"
    | "mark_failed"
    | "mark_issued"
    | "mark_uncertain";
  readonly reservationId?: WorkspaceReservationId;
  readonly message: string;
}> {}

const storageError = (
  operation: ReservationAccessStorageError["operation"],
  reservationId: WorkspaceReservationId | undefined,
  message: string
) => new ReservationAccessStorageError({ operation, reservationId, message });

const toGrant = (row: ReservationAccessGrantRow): ReservationAccessGrant => ({
  id: row.id,
  workspaceReservationId: row.workspaceReservationId,
  deviceId: row.deviceId,
  state: row.state,
  providerCredentialId: row.providerCredentialId,
  reservationStartsAt: row.reservationStartsAt,
  accessStartsAt: row.accessStartsAt,
  accessEndsAt: row.accessEndsAt,
  provisioningStartedAt: row.provisioningStartedAt,
  issuedAt: row.issuedAt,
  failedAt: row.failedAt,
  failureCode: row.failureCode,
  updatedAt: row.updatedAt,
});

export interface IReservationAccessRepository {
  readonly ensure: (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly deviceId: IgloohomeDeviceId;
    readonly reservationStartsAt: Temporal.Instant;
    readonly accessStartsAt: Temporal.Instant;
    readonly accessEndsAt: Temporal.Instant;
  }) => Effect.Effect<ReservationAccessGrant, ReservationAccessStorageError>;
  readonly findByReservationId: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    ReservationAccessGrant | null,
    ReservationAccessStorageError
  >;
  readonly claim: (input: {
    readonly id: ReservationAccessGrantId;
    readonly reservationId: WorkspaceReservationId;
    readonly startedAt: Temporal.Instant;
  }) => Effect.Effect<boolean, ReservationAccessStorageError>;
  readonly markIssued: (input: {
    readonly id: ReservationAccessGrantId;
    readonly reservationId: WorkspaceReservationId;
    readonly accessCode: AlgoPin;
    readonly pinId: IgloohomePinId;
    readonly issuedAt: Temporal.Instant;
  }) => Effect.Effect<void, ReservationAccessStorageError>;
  readonly markFailed: (input: {
    readonly id: ReservationAccessGrantId;
    readonly reservationId: WorkspaceReservationId;
    readonly failureCode: string;
    readonly failedAt: Temporal.Instant;
  }) => Effect.Effect<void, ReservationAccessStorageError>;
  readonly markUncertain: (input: {
    readonly id: ReservationAccessGrantId;
    readonly reservationId: WorkspaceReservationId;
    readonly failureCode: string;
    readonly failedAt: Temporal.Instant;
  }) => Effect.Effect<void, ReservationAccessStorageError>;
  readonly loadIssuedCode: (input: {
    readonly id: ReservationAccessGrantId;
    readonly reservationId: WorkspaceReservationId;
  }) => Effect.Effect<AlgoPin, ReservationAccessStorageError>;
  readonly clearExpiredAccessCodes: (
    now: Temporal.Instant
  ) => Effect.Effect<number, ReservationAccessStorageError>;
}

export class ReservationAccessRepository extends Context.Service<
  ReservationAccessRepository,
  IReservationAccessRepository
>()("@deskohub-workspace/reservation-access/ReservationAccessRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findByReservationId = Effect.fn(
        "ReservationAccessRepository.findByReservationId"
      )(function* (reservationId: WorkspaceReservationId) {
        const [row] = yield* db
          .select()
          .from(reservationAccessGrants)
          .where(
            eq(reservationAccessGrants.workspaceReservationId, reservationId)
          )
          .limit(1)
          .pipe(
            Effect.mapError(() =>
              storageError(
                "load",
                reservationId,
                "Reservation access grant could not be loaded."
              )
            )
          );
        return row ? toGrant(row) : null;
      });

      return ReservationAccessRepository.of({
        findByReservationId,
        ensure: Effect.fn("ReservationAccessRepository.ensure")(
          function* (input) {
            yield* db
              .insert(reservationAccessGrants)
              .values({
                workspaceReservationId: input.reservationId,
                deviceId: input.deviceId,
                state: "pending",
                reservationStartsAt: input.reservationStartsAt,
                accessStartsAt: input.accessStartsAt,
                accessEndsAt: input.accessEndsAt,
              })
              .onConflictDoUpdate({
                target: reservationAccessGrants.workspaceReservationId,
                set: {
                  deviceId: input.deviceId,
                  reservationStartsAt: input.reservationStartsAt,
                  accessStartsAt: input.accessStartsAt,
                  accessEndsAt: input.accessEndsAt,
                },
                setWhere: inArray(reservationAccessGrants.state, [
                  "pending",
                  "failed",
                ]),
              })
              .pipe(
                Effect.mapError(() =>
                  storageError(
                    "ensure",
                    input.reservationId,
                    "Reservation access grant could not be created."
                  )
                )
              );

            const grant = yield* findByReservationId(input.reservationId);
            if (!grant) {
              return yield* storageError(
                "ensure",
                input.reservationId,
                "Reservation access grant disappeared after creation."
              );
            }

            const retryableGrantHasDifferentTarget =
              (grant.state === "pending" || grant.state === "failed") &&
              (grant.deviceId !== input.deviceId ||
                !grant.reservationStartsAt.equals(input.reservationStartsAt) ||
                !grant.accessStartsAt.equals(input.accessStartsAt) ||
                !grant.accessEndsAt.equals(input.accessEndsAt));
            if (retryableGrantHasDifferentTarget) {
              return yield* storageError(
                "ensure",
                input.reservationId,
                "Existing reservation access grant has a different target interval."
              );
            }

            return grant;
          }
        ),
        claim: Effect.fn("ReservationAccessRepository.claim")(
          function* (input) {
            const claimed = yield* db
              .update(reservationAccessGrants)
              .set({
                state: "provisioning",
                provisioningStartedAt: input.startedAt,
                failedAt: null,
                failureCode: null,
                updatedAt: input.startedAt,
              })
              .where(
                and(
                  eq(reservationAccessGrants.id, input.id),
                  inArray(reservationAccessGrants.state, ["pending", "failed"])
                )
              )
              .returning({ id: reservationAccessGrants.id })
              .pipe(
                Effect.mapError(() =>
                  storageError(
                    "claim",
                    input.reservationId,
                    "Reservation access grant could not be claimed."
                  )
                )
              );
            return claimed.length > 0;
          }
        ),
        markIssued: Effect.fn("ReservationAccessRepository.markIssued")(
          function* (input) {
            const updated = yield* db
              .update(reservationAccessGrants)
              .set({
                state: "issued",
                providerCredentialId: input.pinId,
                accessCode: sensitiveDatabaseParameter(input.accessCode),
                issuedAt: input.issuedAt,
                failedAt: null,
                failureCode: null,
                updatedAt: input.issuedAt,
              })
              .where(
                and(
                  eq(reservationAccessGrants.id, input.id),
                  eq(reservationAccessGrants.state, "provisioning")
                )
              )
              .returning({ id: reservationAccessGrants.id })
              .pipe(
                Effect.withTracerEnabled(false),
                Effect.mapError(() =>
                  storageError(
                    "mark_issued",
                    input.reservationId,
                    "Issued reservation access could not be stored."
                  )
                )
              );
            if (updated.length === 0) {
              return yield* storageError(
                "mark_issued",
                input.reservationId,
                "Reservation access grant was not provisioning."
              );
            }
          }
        ),
        markFailed: Effect.fn("ReservationAccessRepository.markFailed")(
          function* (input) {
            yield* db
              .update(reservationAccessGrants)
              .set({
                state: "failed",
                failedAt: input.failedAt,
                failureCode: input.failureCode,
                updatedAt: input.failedAt,
              })
              .where(
                and(
                  eq(reservationAccessGrants.id, input.id),
                  eq(reservationAccessGrants.state, "provisioning")
                )
              )
              .pipe(
                Effect.mapError(() =>
                  storageError(
                    "mark_failed",
                    input.reservationId,
                    "Rejected reservation access could not be recorded."
                  )
                )
              );
          }
        ),
        markUncertain: Effect.fn("ReservationAccessRepository.markUncertain")(
          function* (input) {
            yield* db
              .update(reservationAccessGrants)
              .set({
                state: "uncertain",
                accessCode: null,
                failedAt: input.failedAt,
                failureCode: input.failureCode,
                updatedAt: input.failedAt,
              })
              .where(
                and(
                  eq(reservationAccessGrants.id, input.id),
                  or(
                    eq(reservationAccessGrants.state, "issued"),
                    and(
                      eq(reservationAccessGrants.state, "provisioning"),
                      lte(
                        reservationAccessGrants.provisioningStartedAt,
                        input.failedAt
                      )
                    )
                  )
                )
              )
              .pipe(
                Effect.mapError(() =>
                  storageError(
                    "mark_uncertain",
                    input.reservationId,
                    "Uncertain reservation access could not be recorded."
                  )
                )
              );
          }
        ),
        clearExpiredAccessCodes: Effect.fn(
          "ReservationAccessRepository.clearExpiredAccessCodes"
        )(function* (now) {
          const cleared = yield* db
            .update(reservationAccessGrants)
            .set({ state: "expired", accessCode: null, updatedAt: now })
            .where(
              and(
                isNotNull(reservationAccessGrants.accessCode),
                eq(reservationAccessGrants.state, "issued"),
                lte(reservationAccessGrants.accessEndsAt, now)
              )
            )
            .returning({ id: reservationAccessGrants.id })
            .pipe(
              Effect.withTracerEnabled(false),
              Effect.mapError(() =>
                storageError(
                  "clear_expired",
                  undefined,
                  "Expired reservation access credentials could not be cleared."
                )
              )
            );
          return cleared.length;
        }),
        loadIssuedCode: Effect.fn("ReservationAccessRepository.loadIssuedCode")(
          function* (input) {
            const [row] = yield* db
              .select({
                pin: reservationAccessGrants.accessCode,
              })
              .from(reservationAccessGrants)
              .where(
                and(
                  eq(reservationAccessGrants.id, input.id),
                  eq(reservationAccessGrants.state, "issued")
                )
              )
              .limit(1)
              .pipe(
                Effect.withTracerEnabled(false),
                Effect.mapError(() =>
                  storageError(
                    "load",
                    input.reservationId,
                    "Reservation access credential could not be loaded."
                  )
                )
              );
            if (!row) {
              return yield* storageError(
                "load",
                input.reservationId,
                "Issued reservation access disappeared while loading."
              );
            }
            return yield* Schema.decodeUnknownEffect(AlgoPinSchema)(
              row.pin
            ).pipe(
              Effect.mapError(() =>
                storageError(
                  "load",
                  input.reservationId,
                  "Stored reservation access credential is invalid."
                )
              )
            );
          }
        ),
      });
    })
  );
}

export const ReservationAccessRepositoryLive = ReservationAccessRepository.Live;
