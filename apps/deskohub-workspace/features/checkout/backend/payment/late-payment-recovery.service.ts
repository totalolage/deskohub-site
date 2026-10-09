import { type DotyposReservationId, DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match } from "effect";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { ensureCoworkPayStateAvailable } from "@/features/reservation/actions/prepare-cowork-pay-state";
import { ensureMeetingRoomPayStateAvailable } from "@/features/reservation/actions/prepare-meeting-room-pay-state";
import { ensureOfficePayStateAvailable } from "@/features/reservation/actions/prepare-office-pay-state";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { CoworkReservationDetails } from "@/features/reservation/cowork-reservation";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import type { OfficeReservationDetails } from "@/features/reservation/office-reservation";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { hasReservationIntervalEnded } from "@/features/reservation/reservation-interval";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  plainDateStringSchema,
  temporalInstantToDate,
} from "@/shared/utils/temporal";
import { WorkspacePaidFulfillmentService } from "../fulfillment/paid-fulfillment.service";
import {
  isReusableHold,
  LatePaymentRecoveryRepository,
} from "../repositories/late-payment-recovery.repository";
import { administrationForcedPaymentCancellationFailureCode } from "../repositories/payment-lifecycle.repository";
import { createWorkspaceDotyposReservation } from "../reservation/dotypos-reservation.adapter";
import {
  getWorkspaceReservationInterval,
  type WorkspaceTableAssignmentReservation,
  WorkspaceTableAssignmentService,
} from "../reservation/workspace-table-assignment.service";

export const latePaymentRecoveryMaxExecutionSeconds = 5 * 60;
const recoveryClaimTimeout = Temporal.Duration.from({
  seconds: latePaymentRecoveryMaxExecutionSeconds + 60,
});

export type LatePaymentRecoveryOutcome =
  | "ignored"
  | "recovered"
  | "refund_required"
  | "review_required";

export class LatePaymentRecoveryError extends Data.TaggedError(
  "LatePaymentRecoveryError"
)<{
  readonly paymentAttemptId: PaymentAttemptId;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ILatePaymentRecoveryService {
  readonly recover: (input: {
    readonly paymentAttemptId: PaymentAttemptId;
  }) => Effect.Effect<LatePaymentRecoveryOutcome, LatePaymentRecoveryError>;
}

type RecreatedReservation = {
  readonly checkoutDetails: CheckoutDetails;
  readonly reservation: WorkspaceTableAssignmentReservation;
};

type CoworkSnapshot = Extract<
  AccountingDocumentSnapshot,
  { readonly reservation: { readonly kind: "cowork" } }
>;
type MeetingRoomSnapshot = Extract<
  AccountingDocumentSnapshot,
  { readonly reservation: { readonly kind: "meeting-room" } }
>;
type OfficeSnapshot = Extract<
  AccountingDocumentSnapshot,
  { readonly reservation: { readonly kind: "office" } }
>;

const isCoworkSnapshot = (
  snapshot: AccountingDocumentSnapshot
): snapshot is CoworkSnapshot => snapshot.reservation.kind === "cowork";
const isMeetingRoomSnapshot = (
  snapshot: AccountingDocumentSnapshot
): snapshot is MeetingRoomSnapshot =>
  snapshot.reservation.kind === "meeting-room";
const isOfficeSnapshot = (
  snapshot: AccountingDocumentSnapshot
): snapshot is OfficeSnapshot => snapshot.reservation.kind === "office";

const reconstructReservation = (
  row: WorkspaceReservation,
  snapshot: AccountingDocumentSnapshot
): RecreatedReservation | null => {
  if (row.reservationDetails.kind !== snapshot.reservation.kind) return null;

  if (isCoworkSnapshot(snapshot)) {
    if (row.reservationDetails.kind !== "cowork") return null;
    const reservation: CoworkReservationDetails = {
      ...row.reservationDetails,
      date: snapshot.reservation.date,
    };
    return {
      reservation,
      checkoutDetails: {
        locale: snapshot.locale,
        legal: {},
        reservation,
        payment: {
          ...snapshot.quote.payment,
          summary: getCoworkCheckoutSummary(reservation, snapshot.quote),
        },
      },
    };
  }
  if (isMeetingRoomSnapshot(snapshot)) {
    const item = snapshot.quote.items[0];
    const reservation: MeetingRoomReservationDetails = {
      kind: "meeting-room",
      duration: item.duration,
      reservationDate: plainDateStringSchema.make(
        Temporal.Instant.from(snapshot.reservation.startsAt)
          .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
          .toPlainDate()
          .toString()
      ),
      startsAt: snapshot.reservation.startsAt,
      endsAt: snapshot.reservation.endsAt,
    };
    return {
      reservation,
      checkoutDetails: {
        locale: snapshot.locale,
        legal: {},
        reservation,
        payment: {
          ...snapshot.quote.payment,
          items: snapshot.quote.items,
        },
      },
    };
  }
  if (isOfficeSnapshot(snapshot)) {
    const reservation: OfficeReservationDetails = snapshot.reservation;
    return {
      reservation,
      checkoutDetails: {
        locale: snapshot.locale,
        legal: {},
        reservation,
        payment: {
          ...snapshot.quote.payment,
          items: snapshot.quote.items,
        },
      },
    };
  }
  return null;
};

const ensureAvailable = (
  availability: typeof WorkspaceAvailabilityService.Service,
  reservation: WorkspaceTableAssignmentReservation
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork) =>
        ensureCoworkPayStateAvailable({
          availability,
          reservation: cowork,
        }),
      "meeting-room": (meetingRoom) =>
        ensureMeetingRoomPayStateAvailable({
          availability,
          reservation: meetingRoom,
        }),
      office: (office) =>
        ensureOfficePayStateAvailable({ availability, reservation: office }),
    })
  );

const recoveryMarker = (reservationId: WorkspaceReservationId) =>
  `Payment order: ${reservationId}`;

/**
 * Local states whose original Dotypos hold may still exist and must be
 * released before the reservation is created again.
 */
const releasableReservationStates: ReadonlySet<string> = new Set([
  "held",
  "hold_expired",
  "cancellation_failed",
  "cancelling",
]);

/**
 * A `cancelling` row untouched for this long belongs to an interrupted run, so
 * recovery may finish that cancellation instead of waiting indefinitely.
 */
const staleHoldCancellationAfter = Temporal.Duration.from({ minutes: 10 });

export class LatePaymentRecoveryService extends Context.Service<
  LatePaymentRecoveryService,
  ILatePaymentRecoveryService
>()("LatePaymentRecoveryService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const recoveries = yield* LatePaymentRecoveryRepository;
      const reservations = yield* WorkspaceReservationRepository;
      const snapshots = yield* AccountingDocumentSnapshotRepository;
      const availability = yield* WorkspaceAvailabilityService;
      const dotypos = yield* DotyposService;
      const tableAssignments = yield* WorkspaceTableAssignmentService;
      const fulfillment = yield* WorkspacePaidFulfillmentService;

      const settleRefund = (input: {
        readonly paymentAttemptId: PaymentAttemptId;
        readonly workspaceReservationId: WorkspaceReservationId;
        readonly failureCode: string;
      }) =>
        recoveries.requireRefund({
          ...input,
          completedAt: Temporal.Now.instant(),
        });

      const settleReview = (input: {
        readonly paymentAttemptId: PaymentAttemptId;
        readonly workspaceReservationId: WorkspaceReservationId;
        readonly failureCode: string;
      }) =>
        recoveries.requireReview({
          ...input,
          completedAt: Temporal.Now.instant(),
        });

      const retryLater = (
        paymentAttemptId: PaymentAttemptId,
        message: string
      ) => new LatePaymentRecoveryError({ paymentAttemptId, message });

      /**
       * Cancels the original Dotypos hold and records the local cancellation so
       * the reservation can only continue through normal reservation creation.
       * Fails (to be retried by the queue) while another workflow owns a fresh
       * cancellation or when Dotypos cannot cancel the hold.
       */
      const releaseOriginalHold = Effect.fn(
        "latePaymentRecovery.releaseOriginalHold"
      )(function* (input: {
        readonly paymentAttemptId: PaymentAttemptId;
        readonly reservation: WorkspaceReservation;
        readonly originalDotyposReservationId: DotyposReservationId;
      }) {
        const { reservation } = input;
        if (reservation.reservationState === "cancelled") {
          return "released" as const;
        }
        if (!releasableReservationStates.has(reservation.reservationState)) {
          yield* settleReview({
            paymentAttemptId: input.paymentAttemptId,
            workspaceReservationId: reservation.id,
            failureCode: "late_payment_reservation_state_unexpected",
          });
          return "review_required" as const;
        }
        const resumesStaleCancellation =
          reservation.reservationState === "cancelling";
        if (
          resumesStaleCancellation &&
          Temporal.Instant.compare(
            reservation.updatedAt,
            Temporal.Now.instant().subtract(staleHoldCancellationAfter)
          ) > 0
        ) {
          return yield* retryLater(
            input.paymentAttemptId,
            "Late-payment recovery is waiting for hold cancellation."
          );
        }

        const status = yield* dotypos.getReservationStatus(
          input.originalDotyposReservationId
        );
        if (status !== "NEW" && status !== "CANCELLED") {
          yield* settleReview({
            paymentAttemptId: input.paymentAttemptId,
            workspaceReservationId: reservation.id,
            failureCode:
              status === "CONFIRMED"
                ? "late_payment_original_confirmed"
                : "late_payment_original_cancellation_uncertain",
          });
          return "review_required" as const;
        }

        if (!resumesStaleCancellation) {
          const claimed = yield* reservations.claimCancellation(reservation.id);
          if (!claimed) {
            return yield* retryLater(
              input.paymentAttemptId,
              "Late-payment recovery could not claim the original hold cancellation."
            );
          }
        }
        if (status === "NEW") {
          yield* dotypos
            .cancelReservation(input.originalDotyposReservationId)
            .pipe(
              Effect.tapError(() =>
                reservations
                  .markCancellationFailed({
                    id: reservation.id,
                    failureCode: "dotypos_cancel_failed",
                  })
                  .pipe(Effect.ignore)
              )
            );
        }
        yield* reservations
          .markCancelled({
            id: reservation.id,
            cancelledAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.catchTag(
              "WorkspaceReservationStateError",
              Effect.fn(function* (cause) {
                // A concurrent cleanup may have finished the same cancellation.
                const current = yield* reservations.findById(reservation.id);
                if (current?.reservationState !== "cancelled") {
                  return yield* cause;
                }
              })
            )
          );
        return "released" as const;
      });

      /**
       * Runs the normal reservation creation for the immutable accepted
       * reservation: ended check, current availability, table assignment, and
       * a new confirmed Dotypos reservation. Refunds only when the reservation
       * can no longer be provided.
       */
      const recreateReservation = Effect.fn(
        "latePaymentRecovery.recreateReservation"
      )(function* (input: {
        readonly paymentAttemptId: PaymentAttemptId;
        readonly reservation: WorkspaceReservation;
        readonly newerReservation: boolean;
      }) {
        const { reservation } = input;
        const refund = (failureCode: string) =>
          settleRefund({
            paymentAttemptId: input.paymentAttemptId,
            workspaceReservationId: reservation.id,
            failureCode,
          }).pipe(Effect.as("refund_required" as const));

        const snapshot = yield* snapshots.findByPaymentAttemptId(
          input.paymentAttemptId
        );
        const recreated = snapshot
          ? reconstructReservation(reservation, snapshot)
          : null;
        if (!recreated) {
          return yield* refund(
            input.newerReservation
              ? "late_payment_newer_reservation"
              : "late_payment_snapshot_unavailable"
          );
        }

        const interval = yield* getWorkspaceReservationInterval(
          recreated.reservation
        );
        if (hasReservationIntervalEnded(interval)) {
          return yield* refund("late_payment_reservation_ended");
        }

        const marker = recoveryMarker(reservation.id);
        const matchingReservations =
          (yield* dotypos.listActiveReservationsOverlapping({
            startDate: temporalInstantToDate(
              Temporal.Instant.from(interval.startsAt)
            ),
            endDate: temporalInstantToDate(
              Temporal.Instant.from(interval.endsAt)
            ),
          })).filter((candidate) =>
            candidate.note?.split("\n").includes(marker)
          );

        if (matchingReservations.length > 1) {
          yield* settleReview({
            paymentAttemptId: input.paymentAttemptId,
            workspaceReservationId: reservation.id,
            failureCode: "late_payment_replacement_ambiguous",
          });
          return "review_required" as const;
        }

        if (input.newerReservation) {
          const orphanedReplacementId = matchingReservations[0]?.id;
          if (orphanedReplacementId) {
            yield* dotypos.cancelReservation(orphanedReplacementId);
          }
          return yield* refund("late_payment_newer_reservation");
        }

        // A replacement from an interrupted earlier run already passed the
        // availability check and table assignment before it was created.
        let replacementId = matchingReservations[0]?.id;
        let replacementState =
          matchingReservations[0]?.status === "CONFIRMED"
            ? ("confirmed" as const)
            : ("held" as const);
        if (!replacementId) {
          const replacement = yield* ensureAvailable(
            availability,
            recreated.reservation
          ).pipe(
            Effect.andThen(
              createWorkspaceDotyposReservation({
                paymentOrderId: reservation.id,
                dotyposCustomerId: reservation.dotyposCustomerId,
                checkoutDetails: recreated.checkoutDetails,
                reservation: recreated.reservation,
                status: "CONFIRMED",
              })
            ),
            Effect.provideService(DotyposService, dotypos),
            Effect.provideService(
              WorkspaceTableAssignmentService,
              tableAssignments
            ),
            Effect.map((created) => created.id),
            Effect.catchTags({
              WorkspaceTableUnavailableError: () => Effect.succeed(null),
              TableAssignmentUnavailableError: () => Effect.succeed(null),
            })
          );
          if (replacement === null) {
            return yield* refund("late_payment_reservation_unavailable");
          }
          replacementId = replacement;
          replacementState = "confirmed";
        }

        if (!replacementId) {
          yield* settleReview({
            paymentAttemptId: input.paymentAttemptId,
            workspaceReservationId: reservation.id,
            failureCode: "late_payment_replacement_id_missing",
          });
          return "review_required" as const;
        }

        const confirmedReplacementId = replacementId;
        yield* recoveries
          .completeWithReplacement({
            paymentAttemptId: input.paymentAttemptId,
            workspaceReservationId: reservation.id,
            recoveredDotyposReservationId: confirmedReplacementId,
            reservationState: replacementState,
            completedAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.catchTag(
              "LatePaymentRecoveryStateError",
              Effect.fn(function* (cause) {
                const superseded = yield* recoveries.hasNewerActiveReservation(
                  reservation.id
                );
                if (!superseded) return yield* cause;
                yield* dotypos.cancelReservation(confirmedReplacementId);
                yield* refund("late_payment_newer_reservation");
              })
            ),
            Effect.catchTag(
              "DiscountClaimError",
              Effect.fn(function* () {
                yield* dotypos.cancelReservation(confirmedReplacementId);
                yield* refund("late_payment_discount_unavailable");
              })
            )
          );
        const settled = yield* recoveries.findByPaymentAttemptId(
          input.paymentAttemptId
        );
        if (settled?.state === "refund_required") {
          return "refund_required" as const;
        }
        yield* fulfillment.fulfillPaidOrder({ orderId: reservation.id });
        return "recovered" as const;
      });

      const recover = Effect.fn("latePaymentRecovery.recover")(
        function* (input: { readonly paymentAttemptId: PaymentAttemptId }) {
          const current = yield* recoveries.findByPaymentAttemptId(
            input.paymentAttemptId
          );
          if (!current) return "ignored" as const;
          if (current.state === "recovered") {
            yield* fulfillment.fulfillPaidOrder({
              orderId: current.workspaceReservationId,
            });
            return "recovered" as const;
          }
          if (
            current.state === "refund_required" ||
            current.state === "review_required"
          ) {
            return current.state;
          }

          const claimed = yield* recoveries.claim({
            paymentAttemptId: input.paymentAttemptId,
            staleProcessingBefore:
              Temporal.Now.instant().subtract(recoveryClaimTimeout),
          });
          if (!claimed) {
            return yield* retryLater(
              input.paymentAttemptId,
              "Late-payment recovery is already processing."
            );
          }

          const reservation = yield* reservations.findById(
            claimed.workspaceReservationId
          );
          if (!reservation) {
            return yield* Effect.die(
              "Late-payment recovery reservation missing despite its foreign key."
            );
          }

          if (reservation.activePaymentAttemptId !== claimed.paymentAttemptId) {
            yield* settleRefund({
              paymentAttemptId: claimed.paymentAttemptId,
              workspaceReservationId: reservation.id,
              failureCode: "late_payment_superseded_attempt",
            });
            return "refund_required" as const;
          }
          if (
            reservation.failureCode ===
            administrationForcedPaymentCancellationFailureCode
          ) {
            yield* settleRefund({
              paymentAttemptId: claimed.paymentAttemptId,
              workspaceReservationId: reservation.id,
              failureCode: "late_payment_after_administration_cancellation",
            });
            return "refund_required" as const;
          }

          let newerReservation = yield* recoveries.hasNewerActiveReservation(
            reservation.id
          );
          // Release from the current row: a concurrent cleanup may have moved
          // it since this run loaded it.
          const release = Effect.fn("latePaymentRecovery.releaseCurrentHold")(
            function* () {
              const current = yield* reservations.findById(reservation.id);
              if (!current) {
                return yield* Effect.die(
                  "Late-payment recovery reservation disappeared before release."
                );
              }
              return yield* releaseOriginalHold({
                paymentAttemptId: claimed.paymentAttemptId,
                reservation: current,
                originalDotyposReservationId:
                  claimed.originalDotyposReservationId,
              });
            }
          );

          // Only a hold that never passed its deadline was never offered to
          // other customers as free inventory, so only it skips the normal
          // availability check and table assignment.
          if (
            !newerReservation &&
            isReusableHold(reservation, Temporal.Now.instant())
          ) {
            const status = yield* dotypos.getReservationStatus(
              claimed.originalDotyposReservationId
            );
            if (status === "NEW" || status === "CONFIRMED") {
              const reuse = yield* recoveries
                .completeUsingOriginalReservation({
                  paymentAttemptId: claimed.paymentAttemptId,
                  workspaceReservationId: reservation.id,
                  reservationState:
                    status === "CONFIRMED" ? "confirmed" : "held",
                  completedAt: Temporal.Now.instant(),
                })
                .pipe(
                  Effect.as("reused" as const),
                  Effect.catchTags({
                    DiscountClaimError: () =>
                      Effect.succeed("discount_unavailable" as const),
                    // The deadline reached the margin between the first check
                    // and the locked settlement: recreate in this same run
                    // instead of waiting for the claim timeout.
                    OriginalHoldNotReusableError: () =>
                      Effect.succeed("hold_not_reusable" as const),
                  })
                );
              if (reuse === "reused") {
                yield* fulfillment.fulfillPaidOrder({
                  orderId: reservation.id,
                });
                return "recovered" as const;
              }
              if (reuse === "discount_unavailable") {
                // The accepted discounted price can no longer be honoured: free
                // the slot before the refund marks the reservation paid.
                if ((yield* release()) === "review_required") {
                  return "review_required" as const;
                }
                yield* settleRefund({
                  paymentAttemptId: claimed.paymentAttemptId,
                  workspaceReservationId: reservation.id,
                  failureCode: "late_payment_discount_unavailable",
                });
                return "refund_required" as const;
              }
              newerReservation = yield* recoveries.hasNewerActiveReservation(
                reservation.id
              );
            }
          }

          if ((yield* release()) === "review_required") {
            return "review_required" as const;
          }
          const released = yield* reservations.findById(reservation.id);
          if (!released) {
            return yield* Effect.die(
              "Late-payment recovery reservation disappeared after release."
            );
          }
          return yield* recreateReservation({
            paymentAttemptId: claimed.paymentAttemptId,
            reservation: released,
            newerReservation,
          });
        }
      );

      return LatePaymentRecoveryService.of({
        recover: (input) =>
          recover(input).pipe(
            Effect.mapError((cause) =>
              cause instanceof LatePaymentRecoveryError
                ? cause
                : new LatePaymentRecoveryError({
                    paymentAttemptId: input.paymentAttemptId,
                    message: "Late-payment recovery failed.",
                    cause,
                  })
            )
          ),
      });
    })
  );
}
