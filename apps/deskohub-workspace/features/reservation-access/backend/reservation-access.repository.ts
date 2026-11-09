import type {
  AlgoPin,
  IgloohomeDeviceId,
  IgloohomePinId,
} from "@deskohub/igloohome";
import { AlgoPinSchema } from "@deskohub/igloohome";
import { NodeCrypto } from "@effect/platform-node";
import { and, eq, inArray, lte, or } from "drizzle-orm";
import { Context, Crypto, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { reservationAccessGrants } from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  makeReservationAccessName,
  type ReservationAccessGrant,
  type ReservationAccessGrantId,
  reservationAccessGrantIdSchema,
} from "../reservation-access";

const reservationAccessGrantSelection = {
  id: reservationAccessGrants.id,
  reservationId: reservationAccessGrants.workspaceReservationId,
  provider: reservationAccessGrants.provider,
  credentialType: reservationAccessGrants.credentialType,
  deviceId: reservationAccessGrants.deviceId,
  state: reservationAccessGrants.state,
  providerCredentialId: reservationAccessGrants.providerCredentialId,
  accessName: reservationAccessGrants.accessName,
  scheduledAccessStartsAt: reservationAccessGrants.scheduledAccessStartsAt,
  accessStartsAt: reservationAccessGrants.accessStartsAt,
  accessEndsAt: reservationAccessGrants.accessEndsAt,
  provisioningStartedAt: reservationAccessGrants.provisioningStartedAt,
  issuedAt: reservationAccessGrants.issuedAt,
  failedAt: reservationAccessGrants.failedAt,
  failureCode: reservationAccessGrants.failureCode,
  createdAt: reservationAccessGrants.createdAt,
  updatedAt: reservationAccessGrants.updatedAt,
};

export class ReservationAccessStorageError extends Data.TaggedError(
  "ReservationAccessStorageError"
)<{
  readonly operation:
    | "claim"
    | "ensure"
    | "load"
    | "mark_failed"
    | "mark_issued"
    | "mark_uncertain"
    | "reconcile_uncertain"
    | "reschedule_issued";
  readonly reservationId?: WorkspaceReservationId;
  readonly message: string;
}> {}

interface ReservationAccessBounds {
  readonly scheduledAccessStartsAt: Temporal.Instant;
  readonly accessStartsAt: Temporal.Instant;
  readonly accessEndsAt: Temporal.Instant;
}

const hasBounds = (bounds: ReservationAccessBounds) =>
  and(
    eq(
      reservationAccessGrants.scheduledAccessStartsAt,
      bounds.scheduledAccessStartsAt
    ),
    eq(reservationAccessGrants.accessStartsAt, bounds.accessStartsAt),
    eq(reservationAccessGrants.accessEndsAt, bounds.accessEndsAt)
  );

export interface IReservationAccessRepository {
  /**
   * Creates the grant, or resets a retryable one, for a target. An issued
   * grant is reset only when it still holds `replacingIssued`, the bounds of
   * the issued grant the caller read and decided to replace. Callers replace
   * only a grant programmed for other Igloohome hours, so a grant any
   * deployment issued for the requested hours is never reset.
   */
  readonly ensure: (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly deviceId: IgloohomeDeviceId;
    readonly scheduledAccessStartsAt: Temporal.Instant;
    readonly accessStartsAt: Temporal.Instant;
    readonly accessEndsAt: Temporal.Instant;
    readonly replacingIssued: ReservationAccessBounds | null;
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
    readonly scheduledAccessStartsAt: Temporal.Instant;
    readonly accessStartsAt: Temporal.Instant;
    readonly accessEndsAt: Temporal.Instant;
    readonly accessName: string;
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
  /**
   * Records a reservation span that moved within the hours its issued
   * credential covers. Returns null when the grant holds neither span,
   * because a concurrent request moved or reset it.
   */
  readonly rescheduleIssued: (input: {
    readonly id: ReservationAccessGrantId;
    readonly reservationId: WorkspaceReservationId;
    readonly from: ReservationAccessBounds;
    readonly to: ReservationAccessBounds;
    readonly rescheduledAt: Temporal.Instant;
  }) => Effect.Effect<
    ReservationAccessGrant | null,
    ReservationAccessStorageError
  >;
  readonly loadIssuedCode: (input: {
    readonly id: ReservationAccessGrantId;
    readonly reservationId: WorkspaceReservationId;
    readonly scheduledAccessStartsAt: Temporal.Instant;
    readonly accessStartsAt: Temporal.Instant;
    readonly accessEndsAt: Temporal.Instant;
  }) => Effect.Effect<AlgoPin, ReservationAccessStorageError>;
  readonly reconcileUncertain: (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly reconciledAt: Temporal.Instant;
    readonly provisioningStaleBefore: Temporal.Instant;
  }) => Effect.Effect<ReservationAccessGrant, ReservationAccessStorageError>;
}

export class ReservationAccessRepository extends Context.Service<
  ReservationAccessRepository,
  IReservationAccessRepository
>()("@deskohub-workspace/reservation-access/ReservationAccessRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const crypto = yield* Crypto.Crypto;

      const findByReservationId = Effect.fn(
        "ReservationAccessRepository.findByReservationId"
      )(function* (reservationId: WorkspaceReservationId) {
        const [row] = yield* db
          .select(reservationAccessGrantSelection)
          .from(reservationAccessGrants)
          .where(
            eq(reservationAccessGrants.workspaceReservationId, reservationId)
          )
          .limit(1)
          .pipe(
            Effect.mapError(
              () =>
                new ReservationAccessStorageError({
                  operation: "load",
                  reservationId,
                  message: "Reservation access grant could not be loaded.",
                })
            )
          );
        return row ?? null;
      });

      return ReservationAccessRepository.of({
        findByReservationId,
        ensure: Effect.fn("ReservationAccessRepository.ensure")(
          function* (input) {
            const id = yield* crypto.randomUUIDv7.pipe(
              Effect.map(reservationAccessGrantIdSchema.make),
              Effect.mapError(
                () =>
                  new ReservationAccessStorageError({
                    operation: "ensure",
                    reservationId: input.reservationId,
                    message:
                      "Reservation access grant ID could not be generated.",
                  })
              )
            );
            yield* db
              .insert(reservationAccessGrants)
              .values({
                id,
                // A new grant carries the name its first request will use. A
                // grant created by a deployment that predates stored names
                // has none, and a reset keeps the name of the latest request.
                accessName: makeReservationAccessName(id),
                workspaceReservationId: input.reservationId,
                deviceId: input.deviceId,
                state: "pending",
                scheduledAccessStartsAt: input.scheduledAccessStartsAt,
                accessStartsAt: input.accessStartsAt,
                accessEndsAt: input.accessEndsAt,
              })
              .onConflictDoUpdate({
                target: reservationAccessGrants.workspaceReservationId,
                set: {
                  deviceId: input.deviceId,
                  state: "pending",
                  providerCredentialId: null,
                  accessCode: null,
                  scheduledAccessStartsAt: input.scheduledAccessStartsAt,
                  accessStartsAt: input.accessStartsAt,
                  accessEndsAt: input.accessEndsAt,
                  provisioningStartedAt: null,
                  issuedAt: null,
                  failedAt: null,
                  failureCode: null,
                },
                // Reset an issued grant only for the moved schedule the
                // caller read. A request that raced a concurrent issuance or
                // reschedule must reuse the stored PIN rather than wipe it
                // and provision a second credential.
                setWhere: or(
                  inArray(reservationAccessGrants.state, ["pending", "failed"]),
                  input.replacingIssued
                    ? and(
                        eq(reservationAccessGrants.state, "issued"),
                        hasBounds(input.replacingIssued)
                      )
                    : undefined
                ),
              })
              .pipe(
                Effect.mapError(
                  () =>
                    new ReservationAccessStorageError({
                      operation: "ensure",
                      reservationId: input.reservationId,
                      message: "Reservation access grant could not be created.",
                    })
                )
              );

            const grant = yield* findByReservationId(input.reservationId);
            if (!grant) {
              return yield* new ReservationAccessStorageError({
                operation: "ensure",
                reservationId: input.reservationId,
                message: "Reservation access grant disappeared after creation.",
              });
            }

            const retryableGrantHasDifferentTarget =
              (grant.state === "pending" || grant.state === "failed") &&
              (grant.deviceId !== input.deviceId ||
                !grant.scheduledAccessStartsAt.equals(
                  input.scheduledAccessStartsAt
                ) ||
                !grant.accessStartsAt.equals(input.accessStartsAt) ||
                !grant.accessEndsAt.equals(input.accessEndsAt));
            if (retryableGrantHasDifferentTarget) {
              return yield* new ReservationAccessStorageError({
                operation: "ensure",
                reservationId: input.reservationId,
                message:
                  "Existing reservation access grant has a different target interval.",
              });
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
                accessName: input.accessName,
                provisioningStartedAt: input.startedAt,
                failedAt: null,
                failureCode: null,
                updatedAt: input.startedAt,
              })
              // Claim only the exact reservation bounds this request read.
              // A concurrent request may have changed the grant's target.
              .where(
                and(
                  eq(reservationAccessGrants.id, input.id),
                  inArray(reservationAccessGrants.state, ["pending", "failed"]),
                  eq(
                    reservationAccessGrants.scheduledAccessStartsAt,
                    input.scheduledAccessStartsAt
                  ),
                  eq(
                    reservationAccessGrants.accessStartsAt,
                    input.accessStartsAt
                  ),
                  eq(reservationAccessGrants.accessEndsAt, input.accessEndsAt)
                )
              )
              .returning({ id: reservationAccessGrants.id })
              .pipe(
                Effect.mapError(
                  () =>
                    new ReservationAccessStorageError({
                      operation: "claim",
                      reservationId: input.reservationId,
                      message: "Reservation access grant could not be claimed.",
                    })
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
                accessCode: input.accessCode,
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
                Effect.mapError(
                  () =>
                    new ReservationAccessStorageError({
                      operation: "mark_issued",
                      reservationId: input.reservationId,
                      message: "Issued reservation access could not be stored.",
                    })
                )
              );
            if (updated.length === 0) {
              return yield* new ReservationAccessStorageError({
                operation: "mark_issued",
                reservationId: input.reservationId,
                message: "Reservation access grant was not provisioning.",
              });
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
                Effect.mapError(
                  () =>
                    new ReservationAccessStorageError({
                      operation: "mark_failed",
                      reservationId: input.reservationId,
                      message:
                        "Rejected reservation access could not be recorded.",
                    })
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
                Effect.mapError(
                  () =>
                    new ReservationAccessStorageError({
                      operation: "mark_uncertain",
                      reservationId: input.reservationId,
                      message:
                        "Uncertain reservation access could not be recorded.",
                    })
                )
              );
          }
        ),
        rescheduleIssued: Effect.fn(
          "ReservationAccessRepository.rescheduleIssued"
        )(function* (input) {
          const [grant] = yield* db
            .update(reservationAccessGrants)
            .set({
              scheduledAccessStartsAt: input.to.scheduledAccessStartsAt,
              accessStartsAt: input.to.accessStartsAt,
              accessEndsAt: input.to.accessEndsAt,
              updatedAt: input.rescheduledAt,
            })
            .where(
              and(
                eq(reservationAccessGrants.id, input.id),
                eq(reservationAccessGrants.state, "issued"),
                // A concurrent request recording the same span succeeds too.
                or(hasBounds(input.from), hasBounds(input.to))
              )
            )
            .returning(reservationAccessGrantSelection)
            .pipe(
              Effect.mapError(
                () =>
                  new ReservationAccessStorageError({
                    operation: "reschedule_issued",
                    reservationId: input.reservationId,
                    message:
                      "Rescheduled reservation access could not be recorded.",
                  })
              )
            );
          return grant ?? null;
        }),
        reconcileUncertain: Effect.fn(
          "ReservationAccessRepository.reconcileUncertain"
        )(function* (input) {
          const [grant] = yield* db
            .update(reservationAccessGrants)
            .set({
              state: "failed",
              providerCredentialId: null,
              provisioningStartedAt: null,
              issuedAt: null,
              failedAt: input.reconciledAt,
              failureCode: "provider_credential_removed",
              updatedAt: input.reconciledAt,
            })
            .where(
              and(
                eq(
                  reservationAccessGrants.workspaceReservationId,
                  input.reservationId
                ),
                or(
                  eq(reservationAccessGrants.state, "uncertain"),
                  and(
                    eq(reservationAccessGrants.state, "provisioning"),
                    lte(
                      reservationAccessGrants.provisioningStartedAt,
                      input.provisioningStaleBefore
                    )
                  )
                )
              )
            )
            .returning(reservationAccessGrantSelection)
            .pipe(
              Effect.mapError(
                () =>
                  new ReservationAccessStorageError({
                    operation: "reconcile_uncertain",
                    reservationId: input.reservationId,
                    message:
                      "Uncertain reservation access could not be reconciled.",
                  })
              )
            );
          if (!grant) {
            return yield* new ReservationAccessStorageError({
              operation: "reconcile_uncertain",
              reservationId: input.reservationId,
              message: "Reservation access is not awaiting reconciliation.",
            });
          }
          return grant;
        }),
        loadIssuedCode: Effect.fn("ReservationAccessRepository.loadIssuedCode")(
          function* (input) {
            const [row] = yield* db
              .select({
                pin: reservationAccessGrants.accessCode,
              })
              .from(reservationAccessGrants)
              // Never disclose a PIN for other exact reservation bounds
              // than the request read and will show.
              .where(
                and(
                  eq(reservationAccessGrants.id, input.id),
                  eq(reservationAccessGrants.state, "issued"),
                  eq(
                    reservationAccessGrants.scheduledAccessStartsAt,
                    input.scheduledAccessStartsAt
                  ),
                  eq(
                    reservationAccessGrants.accessStartsAt,
                    input.accessStartsAt
                  ),
                  eq(reservationAccessGrants.accessEndsAt, input.accessEndsAt)
                )
              )
              .limit(1)
              .pipe(
                Effect.withTracerEnabled(false),
                Effect.mapError(
                  () =>
                    new ReservationAccessStorageError({
                      operation: "load",
                      reservationId: input.reservationId,
                      message:
                        "Reservation access credential could not be loaded.",
                    })
                )
              );
            if (!row) {
              return yield* new ReservationAccessStorageError({
                operation: "load",
                reservationId: input.reservationId,
                message: "Issued reservation access disappeared while loading.",
              });
            }
            return yield* Schema.decodeUnknownEffect(AlgoPinSchema)(
              row.pin
            ).pipe(
              Effect.mapError(
                () =>
                  new ReservationAccessStorageError({
                    operation: "load",
                    reservationId: input.reservationId,
                    message: "Stored reservation access credential is invalid.",
                  })
              )
            );
          }
        ),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(Layer.mergeAll(WorkspaceDatabase.Default, NodeCrypto.layer))
  );
}
