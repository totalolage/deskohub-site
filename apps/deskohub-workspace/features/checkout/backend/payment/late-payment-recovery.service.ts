import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match } from "effect";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type CoworkReservationDetails,
  getCoworkReservationIntervalInput,
} from "@/features/reservation/cowork-reservation";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import {
  getOfficeReservationIntervalInput,
  type OfficeReservationDetails,
} from "@/features/reservation/office-reservation";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  getReservationIntervalNormalization,
  hasReservationIntervalEnded,
} from "@/features/reservation/reservation-interval";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  plainDateStringSchema,
  temporalInstantToDate,
} from "@/shared/utils/temporal";
import { WorkspacePaidFulfillmentService } from "../fulfillment/paid-fulfillment.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { createWorkspaceDotyposReservation } from "../reservation/dotypos-reservation.adapter";
import {
  type WorkspaceTableAssignmentReservation,
  WorkspaceTableAssignmentService,
} from "../reservation/workspace-table-assignment.service";

const recoveryClaimTimeout = Temporal.Duration.from({ minutes: 1 });

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

export interface LatePaymentRecoveryService {
  readonly recover: (input: {
    readonly paymentAttemptId: PaymentAttemptId;
  }) => Effect.Effect<LatePaymentRecoveryOutcome, LatePaymentRecoveryError>;
}

export const LatePaymentRecoveryService =
  Context.Service<LatePaymentRecoveryService>("LatePaymentRecoveryService");

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

const getReservationInterval = (
  reservation: WorkspaceTableAssignmentReservation
) =>
  getReservationIntervalNormalization(
    Match.value(reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: ({ date }) => getCoworkReservationIntervalInput(date),
        "meeting-room": (meetingRoom) => meetingRoom,
        office: getOfficeReservationIntervalInput,
      })
    )
  );

const ensureAvailable = (
  availability: typeof WorkspaceAvailabilityService.Service,
  reservation: WorkspaceTableAssignmentReservation
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork) =>
        availability.ensureAvailable({
          kind: cowork.kind,
          date: cowork.date,
          entryTier: cowork.entryTier,
          monitorOption: cowork.monitorOption,
        }),
      "meeting-room": (meetingRoom) =>
        availability.ensureAvailable({
          kind: meetingRoom.kind,
          startsAt: meetingRoom.startsAt,
          endsAt: meetingRoom.endsAt,
        }),
      office: (office) =>
        getReservationInterval(office).pipe(
          Effect.flatMap((interval) =>
            availability.ensureAvailable({
              kind: office.kind,
              ...interval,
              seats: office.seats,
            })
          )
        ),
    })
  );

const recoveryMarker = (reservationId: WorkspaceReservationId) =>
  `Payment order: ${reservationId}`;

export const LatePaymentRecoveryServiceLive = Layer.effect(
  LatePaymentRecoveryService,
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

    const recover = Effect.fn("latePaymentRecovery.recover")(function* (input: {
      readonly paymentAttemptId: PaymentAttemptId;
    }) {
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
      if (!claimed) return "ignored" as const;

      const reservation = yield* reservations.findById(
        claimed.workspaceReservationId
      );
      if (!reservation) {
        yield* recoveries.requireReview({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: claimed.workspaceReservationId,
          failureCode: "late_payment_reservation_missing",
          completedAt: Temporal.Now.instant(),
        });
        return "review_required" as const;
      }

      const newerReservation = yield* recoveries.hasNewerActiveReservation(
        reservation.id
      );
      if (newerReservation && reservation.reservationState !== "cancelled") {
        yield* settleRefund({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: reservation.id,
          failureCode: "late_payment_newer_reservation",
        });
        return "refund_required" as const;
      }

      if (reservation.reservationState === "held") {
        yield* recoveries.completeUsingOriginalReservation({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: reservation.id,
          reservationState: "held",
          completedAt: Temporal.Now.instant(),
        });
        yield* fulfillment.fulfillPaidOrder({ orderId: reservation.id });
        return "recovered" as const;
      }

      if (reservation.reservationState === "cancelling") {
        return yield* new LatePaymentRecoveryError({
          paymentAttemptId: claimed.paymentAttemptId,
          message: "Late-payment recovery is waiting for hold cancellation.",
        });
      }

      if (reservation.reservationState === "cancellation_failed") {
        const status = yield* dotypos.getReservationStatus(
          claimed.originalDotyposReservationId
        );
        if (status === "NEW" || status === "CONFIRMED") {
          yield* recoveries.completeUsingOriginalReservation({
            paymentAttemptId: claimed.paymentAttemptId,
            workspaceReservationId: reservation.id,
            reservationState: status === "CONFIRMED" ? "confirmed" : "held",
            completedAt: Temporal.Now.instant(),
          });
          yield* fulfillment.fulfillPaidOrder({ orderId: reservation.id });
          return "recovered" as const;
        }
        if (status !== "CANCELLED") {
          yield* recoveries.requireReview({
            paymentAttemptId: claimed.paymentAttemptId,
            workspaceReservationId: reservation.id,
            failureCode: "late_payment_original_cancellation_uncertain",
            completedAt: Temporal.Now.instant(),
          });
          return "review_required" as const;
        }
      } else if (reservation.reservationState !== "cancelled") {
        yield* recoveries.requireReview({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: reservation.id,
          failureCode: "late_payment_reservation_state_unexpected",
          completedAt: Temporal.Now.instant(),
        });
        return "review_required" as const;
      }

      const snapshot = yield* snapshots.findByPaymentAttemptId(
        claimed.paymentAttemptId
      );
      const recreated = snapshot
        ? reconstructReservation(reservation, snapshot)
        : null;
      if (!recreated) {
        yield* settleRefund({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: reservation.id,
          failureCode: "late_payment_snapshot_unavailable",
        });
        return "refund_required" as const;
      }

      const interval = yield* getReservationInterval(recreated.reservation);
      if (hasReservationIntervalEnded(interval)) {
        yield* settleRefund({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: reservation.id,
          failureCode: "late_payment_reservation_ended",
        });
        return "refund_required" as const;
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
        })).filter((candidate) => candidate.note?.split("\n").includes(marker));

      if (matchingReservations.length > 1) {
        yield* recoveries.requireReview({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: reservation.id,
          failureCode: "late_payment_replacement_ambiguous",
          completedAt: Temporal.Now.instant(),
        });
        return "review_required" as const;
      }

      if (newerReservation) {
        const orphanedReplacementId = matchingReservations[0]?.id;
        if (orphanedReplacementId) {
          yield* dotypos.cancelReservation(orphanedReplacementId);
        }
        yield* settleRefund({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: reservation.id,
          failureCode: "late_payment_newer_reservation",
        });
        return "refund_required" as const;
      }

      let replacementId = matchingReservations[0]?.id;
      let replacementState =
        matchingReservations[0]?.status === "CONFIRMED"
          ? ("confirmed" as const)
          : ("held" as const);
      let replacementCreated = false;
      if (!replacementId) {
        const isAvailable = yield* ensureAvailable(
          availability,
          recreated.reservation
        ).pipe(
          Effect.as(true),
          Effect.catchTag("WorkspaceTableUnavailableError", () =>
            Effect.succeed(false)
          )
        );
        if (!isAvailable) {
          yield* settleRefund({
            paymentAttemptId: claimed.paymentAttemptId,
            workspaceReservationId: reservation.id,
            failureCode: "late_payment_reservation_unavailable",
          });
          return "refund_required" as const;
        }

        const replacement = yield* createWorkspaceDotyposReservation({
          paymentOrderId: reservation.id,
          dotyposCustomerId: reservation.dotyposCustomerId,
          checkoutDetails: recreated.checkoutDetails,
          reservation: recreated.reservation,
          status: "CONFIRMED",
        }).pipe(
          Effect.provideService(DotyposService, dotypos),
          Effect.provideService(
            WorkspaceTableAssignmentService,
            tableAssignments
          )
        );
        replacementId = replacement.id;
        replacementState = "confirmed";
        replacementCreated = true;
      }

      if (!replacementId) {
        yield* recoveries.requireReview({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: reservation.id,
          failureCode: "late_payment_replacement_id_missing",
          completedAt: Temporal.Now.instant(),
        });
        return "review_required" as const;
      }

      yield* recoveries
        .completeWithReplacement({
          paymentAttemptId: claimed.paymentAttemptId,
          workspaceReservationId: reservation.id,
          recoveredDotyposReservationId: replacementId,
          reservationState: replacementState,
          completedAt: Temporal.Now.instant(),
        })
        .pipe(
          Effect.catchTag("LatePaymentRecoveryStateError", (cause) =>
            Effect.gen(function* () {
              const superseded = yield* recoveries.hasNewerActiveReservation(
                reservation.id
              );
              if (!(replacementCreated && superseded)) return yield* cause;
              yield* dotypos.cancelReservation(replacementId);
              yield* settleRefund({
                paymentAttemptId: claimed.paymentAttemptId,
                workspaceReservationId: reservation.id,
                failureCode: "late_payment_newer_reservation",
              });
            })
          )
        );
      const settled = yield* recoveries.findByPaymentAttemptId(
        claimed.paymentAttemptId
      );
      if (settled?.state === "refund_required") {
        return "refund_required" as const;
      }
      yield* fulfillment.fulfillPaidOrder({ orderId: reservation.id });
      return "recovered" as const;
    });

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
