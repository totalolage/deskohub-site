import "@/shared/polyfills/temporal";

import {
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match, Predicate } from "effect";
import type { LatePaymentRecovery } from "@/db/schema";
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
import { getMeetingRoomEarlySetupField } from "@/features/reservation/meeting-room-early-setup";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import type { OfficeReservationDetails } from "@/features/reservation/office-reservation";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  hasReservationIntervalEnded,
  type ReservationInterval,
} from "@/features/reservation/reservation-interval";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  plainDateStringSchema,
  temporalInstantToDate,
} from "@/shared/utils/temporal";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import { UnpaidHoldRelease } from "../holds/unpaid-hold-release.service";
import {
  isReusableHold,
  LatePaymentRecoveryRepository,
} from "../repositories/late-payment-recovery.repository";
import { administrationForcedPaymentCancellationFailureCode } from "../repositories/payment-lifecycle.repository";
import {
  createWorkspaceDotyposReservation,
  noteNamesPaymentOrder,
} from "../reservation/dotypos-reservation.adapter";
import {
  getWorkspaceReservationInterval,
  type WorkspaceTableAssignmentReservation,
  WorkspaceTableAssignmentService,
} from "../reservation/workspace-table-assignment.service";

export const latePaymentRecoveryMaxExecutionSeconds = 5 * 60;
const recoveryClaimTimeout = Temporal.Duration.from({
  seconds: latePaymentRecoveryMaxExecutionSeconds + 60,
});

type LatePaymentRecoveryOutcome =
  | "ignored"
  | "recovered"
  | "refund_required"
  | "review_required";

class LatePaymentRecoveryError extends Data.TaggedError(
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
    if (row.reservationDetails.kind !== "meeting-room") return null;
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
      ...getMeetingRoomEarlySetupField(row.reservationDetails),
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

/** Why an original hold Dotypos neither holds NEW nor cancelled needs review. */
const unreleasableOriginalHoldFailureCode = (
  status: DotyposReservation["status"]
) =>
  status === "CONFIRMED"
    ? "late_payment_original_confirmed"
    : "late_payment_original_cancellation_uncertain";

/** Why a reservation without a usable snapshot is refunded. */
const unrecreatableReservationFailureCode = (input: {
  readonly newerReservation: boolean;
}) =>
  input.newerReservation
    ? "late_payment_newer_reservation"
    : "late_payment_snapshot_unavailable";

/**
 * Why a claimed late payment can only be refunded before any hold work: its
 * attempt was superseded, or an operator force-cancelled the reservation.
 */
const unrecoverablePaymentFailureCode = (input: {
  readonly claimed: LatePaymentRecovery;
  readonly reservation: WorkspaceReservation;
}) => {
  if (
    input.reservation.activePaymentAttemptId !== input.claimed.paymentAttemptId
  ) {
    return "late_payment_superseded_attempt";
  }
  if (
    input.reservation.failureCode ===
    administrationForcedPaymentCancellationFailureCode
  ) {
    return "late_payment_after_administration_cancellation";
  }
  return null;
};

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
      const holdRelease = yield* UnpaidHoldRelease;
      const tableAssignments = yield* WorkspaceTableAssignmentService;
      const fulfillment = yield* ReservationFulfillment;

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

      const refundRecovery = (
        input: {
          readonly paymentAttemptId: PaymentAttemptId;
          readonly reservation: WorkspaceReservation;
        },
        failureCode: string
      ) =>
        settleRefund({
          paymentAttemptId: input.paymentAttemptId,
          workspaceReservationId: input.reservation.id,
          failureCode,
        }).pipe(Effect.as("refund_required" as const));

      const reviewRecovery = (
        input: {
          readonly paymentAttemptId: PaymentAttemptId;
          readonly reservation: WorkspaceReservation;
        },
        failureCode: string
      ) =>
        settleReview({
          paymentAttemptId: input.paymentAttemptId,
          workspaceReservationId: input.reservation.id,
          failureCode,
        }).pipe(Effect.as("review_required" as const));

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
        const outcome = yield* holdRelease.release({
          reason: "late_payment",
          reservationId: input.reservation.id,
          originalDotyposReservationId: input.originalDotyposReservationId,
        });
        if (outcome === "in_progress") {
          return yield* retryLater(
            input.paymentAttemptId,
            "Late-payment recovery is waiting for hold cancellation."
          );
        }
        if (outcome === "unclaimed") {
          return yield* retryLater(
            input.paymentAttemptId,
            "Late-payment recovery could not claim the original hold cancellation."
          );
        }
        if (
          outcome === "already_released" ||
          Predicate.hasProperty(outcome, "released")
        ) {
          return "released" as const;
        }
        if (Predicate.hasProperty(outcome, "refused")) {
          return yield* reviewRecovery(
            input,
            unreleasableOriginalHoldFailureCode(outcome.refused)
          );
        }
        return yield* reviewRecovery(
          input,
          "late_payment_reservation_state_unexpected"
        );
      });

      const findRecreatedReservation = Effect.fnUntraced(function* (input: {
        readonly paymentAttemptId: PaymentAttemptId;
        readonly reservation: WorkspaceReservation;
      }) {
        const snapshot = yield* snapshots.findByPaymentAttemptId(
          input.paymentAttemptId
        );
        return snapshot
          ? reconstructReservation(input.reservation, snapshot)
          : null;
      });

      // Replacements an earlier run of this recovery created in Dotypos name
      // the payment order in their note.
      const findRecoveryReplacements = Effect.fnUntraced(function* (input: {
        readonly reservation: WorkspaceReservation;
        readonly interval: Pick<ReservationInterval, "startsAt" | "endsAt">;
      }) {
        return (yield* dotypos.listActiveReservationsOverlapping({
          startDate: temporalInstantToDate(
            Temporal.Instant.from(input.interval.startsAt)
          ),
          endDate: temporalInstantToDate(
            Temporal.Instant.from(input.interval.endsAt)
          ),
        })).filter((candidate) =>
          noteNamesPaymentOrder(candidate.note, input.reservation.id)
        );
      });

      const refundNewerReservation = Effect.fnUntraced(function* (input: {
        readonly paymentAttemptId: PaymentAttemptId;
        readonly reservation: WorkspaceReservation;
        readonly replacements: readonly DotyposReservation[];
      }) {
        const orphanedReplacementId = input.replacements[0]?.id;
        if (orphanedReplacementId) {
          yield* dotypos.cancelReservation(orphanedReplacementId);
        }
        return yield* refundRecovery(input, "late_payment_newer_reservation");
      });

      // A replacement from an interrupted earlier run already passed the
      // availability check and table assignment before it was created; null
      // when a new one can no longer be provided.
      const resumeOrCreateReplacement = Effect.fnUntraced(function* (input: {
        readonly reservation: WorkspaceReservation;
        readonly recreated: RecreatedReservation;
        readonly replacements: readonly DotyposReservation[];
      }) {
        const resumed = input.replacements[0];
        if (resumed?.id) {
          return {
            replacementId: resumed.id,
            replacementState:
              resumed.status === "CONFIRMED"
                ? ("confirmed" as const)
                : ("held" as const),
          };
        }
        const { reservation, recreated } = input;
        const created = yield* ensureAvailable(
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
          Effect.map((replacement) => replacement.id),
          Effect.catchTags({
            WorkspaceTableUnavailableError: () => Effect.succeed(null),
            TableAssignmentUnavailableError: () => Effect.succeed(null),
          })
        );
        return created === null
          ? null
          : { replacementId: created, replacementState: "confirmed" as const };
      });

      // Settles the recovery with the replacement, cancelling it again when a
      // newer reservation or a gone discount wins at settlement, then
      // fulfills a recovered reservation.
      const settleWithReplacement = Effect.fnUntraced(function* (input: {
        readonly paymentAttemptId: PaymentAttemptId;
        readonly reservation: WorkspaceReservation;
        readonly replacementId: DotyposReservationId | undefined;
        readonly replacementState: "confirmed" | "held";
      }) {
        const { reservation } = input;
        if (!input.replacementId) {
          return yield* reviewRecovery(
            input,
            "late_payment_replacement_id_missing"
          );
        }

        const confirmedReplacementId = input.replacementId;
        yield* recoveries
          .completeWithReplacement({
            paymentAttemptId: input.paymentAttemptId,
            workspaceReservationId: reservation.id,
            recoveredDotyposReservationId: confirmedReplacementId,
            reservationState: input.replacementState,
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
                yield* refundRecovery(input, "late_payment_newer_reservation");
              })
            ),
            Effect.catchTag(
              "DiscountClaimError",
              Effect.fn(function* () {
                yield* dotypos.cancelReservation(confirmedReplacementId);
                yield* refundRecovery(
                  input,
                  "late_payment_discount_unavailable"
                );
              })
            )
          );
        const settled = yield* recoveries.findByPaymentAttemptId(
          input.paymentAttemptId
        );
        if (settled?.state === "refund_required") {
          return "refund_required" as const;
        }
        yield* fulfillment.run(reservation.id);
        return "recovered" as const;
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
        const recreated = yield* findRecreatedReservation(input);
        if (!recreated) {
          return yield* refundRecovery(
            input,
            unrecreatableReservationFailureCode(input)
          );
        }

        const interval = yield* getWorkspaceReservationInterval(
          recreated.reservation
        );
        if (hasReservationIntervalEnded(interval)) {
          return yield* refundRecovery(input, "late_payment_reservation_ended");
        }

        const replacements = yield* findRecoveryReplacements({
          reservation: input.reservation,
          interval,
        });
        if (replacements.length > 1) {
          return yield* reviewRecovery(
            input,
            "late_payment_replacement_ambiguous"
          );
        }

        if (input.newerReservation) {
          return yield* refundNewerReservation({ ...input, replacements });
        }

        const replacement = yield* resumeOrCreateReplacement({
          reservation: input.reservation,
          recreated,
          replacements,
        });
        if (!replacement) {
          return yield* refundRecovery(
            input,
            "late_payment_reservation_unavailable"
          );
        }
        return yield* settleWithReplacement({ ...input, ...replacement });
      });

      // A recovery that already ended keeps its outcome; a recovered one runs
      // fulfillment again. Undefined while the recovery is still open.
      const replaySettledRecovery = Effect.fnUntraced(function* (
        current: LatePaymentRecovery | null
      ) {
        if (!current) return "ignored" as const;
        if (current.state === "recovered") {
          yield* fulfillment.run(current.workspaceReservationId);
          return "recovered" as const;
        }
        if (
          current.state === "refund_required" ||
          current.state === "review_required"
        ) {
          return current.state;
        }
        return undefined;
      });

      // Reuses a hold that never passed its deadline. Returns the outcome when
      // reuse settles the recovery, and otherwise whether a newer reservation
      // exists for the recreation that follows.
      const reuseOriginalHold = Effect.fnUntraced(function* (input: {
        readonly claimed: LatePaymentRecovery;
        readonly reservation: WorkspaceReservation;
        readonly release: () => Effect.Effect<
          "released" | "review_required",
          unknown
        >;
      }) {
        const { claimed, reservation } = input;
        const status = yield* dotypos.getReservationStatus(
          claimed.originalDotyposReservationId
        );
        if (status !== "NEW" && status !== "CONFIRMED") {
          return { newerReservation: false };
        }
        const reuse = yield* recoveries
          .completeUsingOriginalReservation({
            paymentAttemptId: claimed.paymentAttemptId,
            workspaceReservationId: reservation.id,
            reservationState: status === "CONFIRMED" ? "confirmed" : "held",
            completedAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.as("reused" as const),
            Effect.catchTags({
              DiscountClaimError: () =>
                Effect.succeed("discount_unavailable" as const),
              // The deadline reached the margin between the first check and
              // the locked settlement: recreate in this same run instead of
              // waiting for the claim timeout.
              OriginalHoldNotReusableError: () =>
                Effect.succeed("hold_not_reusable" as const),
            })
          );
        if (reuse === "reused") {
          yield* fulfillment.run(reservation.id);
          return "recovered" as const;
        }
        if (reuse === "discount_unavailable") {
          // The accepted discounted price can no longer be honoured: free the
          // slot before the refund marks the reservation paid.
          if ((yield* input.release()) === "review_required") {
            return "review_required" as const;
          }
          return yield* refundRecovery(
            { paymentAttemptId: claimed.paymentAttemptId, reservation },
            "late_payment_discount_unavailable"
          );
        }
        return {
          newerReservation: yield* recoveries.hasNewerActiveReservation(
            reservation.id
          ),
        };
      });

      // Reuses the original hold when it may be, and otherwise releases it and
      // recreates the reservation through normal reservation creation.
      const recoverClaimedReservation = Effect.fnUntraced(function* (input: {
        readonly claimed: LatePaymentRecovery;
        readonly reservation: WorkspaceReservation;
      }) {
        const { claimed, reservation } = input;
        let newerReservation = yield* recoveries.hasNewerActiveReservation(
          reservation.id
        );
        // The release reads the current row: a concurrent cleanup may have
        // moved it since this run loaded it.
        const release = () =>
          releaseOriginalHold({
            paymentAttemptId: claimed.paymentAttemptId,
            reservation,
            originalDotyposReservationId: claimed.originalDotyposReservationId,
          });

        // Only a hold that never passed its deadline was never offered to
        // other customers as free inventory, so only it skips the normal
        // availability check and table assignment.
        if (
          !newerReservation &&
          isReusableHold(reservation, Temporal.Now.instant())
        ) {
          const reuse = yield* reuseOriginalHold({
            claimed,
            reservation,
            release,
          });
          if (Predicate.isString(reuse)) {
            return reuse;
          }
          newerReservation = reuse.newerReservation;
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
      });

      const recover = Effect.fn("latePaymentRecovery.recover")(
        function* (input: { readonly paymentAttemptId: PaymentAttemptId }) {
          const current = yield* recoveries.findByPaymentAttemptId(
            input.paymentAttemptId
          );
          const settled = yield* replaySettledRecovery(current);
          if (settled) return settled;

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

          const unrecoverableFailureCode = unrecoverablePaymentFailureCode({
            claimed,
            reservation,
          });
          if (unrecoverableFailureCode) {
            return yield* refundRecovery(
              { paymentAttemptId: claimed.paymentAttemptId, reservation },
              unrecoverableFailureCode
            );
          }

          return yield* recoverClaimedReservation({ claimed, reservation });
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
