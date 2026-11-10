import "@/shared/polyfills/temporal";

import {
  type DotyposReservationId,
  type DotyposReservationStatus,
  DotyposService,
  type DotyposWriteFailure,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Predicate } from "effect";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
  type WorkspaceReservationStateError,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { DotyposHoldRelease } from "./dotypos-hold-release.service";

/**
 * Why an unpaid hold is released. Each reason brings its own policy:
 *
 * - `hold_expired`: hold cleanup of an expired or abandoned hold.
 * - `late_payment`: late-payment recovery frees the original hold before it
 *   recreates the reservation or refunds.
 * - `agent_rotated`: an agent client's hold left behind in a rotated checkout
 *   session.
 */
type UnpaidHoldReleaseReason =
  | "hold_expired"
  | "late_payment"
  | "agent_rotated";

export type UnpaidHoldReleaseRequest =
  | {
      readonly reason: "hold_expired";
      readonly reservationId: WorkspaceReservationId;
      /** When cleanup found the hold expired; recorded with the cancellation. */
      readonly holdExpiredAt?: Temporal.Instant;
    }
  | {
      readonly reason: "late_payment" | "agent_rotated";
      readonly reservationId: WorkspaceReservationId;
    };

/** A hold this run released and marked cancelled. */
interface ReleasedHold {
  /** The reservation as this run took it over, before it was marked cancelled. */
  readonly released: WorkspaceReservation;
  readonly cancelledAt: Temporal.Instant;
}

/** A hold left in Dotypos because of its live status. */
interface RefusedHold {
  readonly refused: DotyposReservationStatus;
}

/**
 * - `already_released`: the reservation was cancelled already, or another run
 *   marked it cancelled while this one released it.
 * - `in_progress`: another run's cancellation of it is fresh, so this run
 *   leaves it alone.
 * - `unclaimed`: the reservation changed before this run could claim it.
 * - `unreleasable`: it isn't an unpaid hold with a Dotypos reservation this
 *   reason may release.
 * - `state_changed`: it left `cancelling` before this run marked it
 *   cancelled, after the Dotypos release.
 * - `refused`: the live Dotypos status kept the hold; under `require_new`
 *   the reservation moved to `cancellation_failed`, under
 *   `read_before_claim` it is untouched.
 */
type UnpaidHoldReleaseOutcome =
  | ReleasedHold
  | "already_released"
  | "in_progress"
  | "unclaimed"
  | "unreleasable"
  | "state_changed"
  | RefusedHold;

type UnpaidHoldReleaseError =
  | DotyposWriteFailure
  | EffectDrizzleQueryError
  | WorkspaceReservationDetailsMalformedError
  | WorkspaceReservationStateError;

/**
 * The `failure_code` a reservation keeps when its Dotypos hold wasn't
 * released. Stored values the administration attention queue reads.
 */
type ReleaseFailureCode =
  | "dotypos_cancel_failed"
  | "checkout_supersession_cancel_failed";

/**
 * How one reason releases a hold.
 *
 * `claim`:
 * - `resume_claimed`: claim the cancellation, or take over a `cancelling`
 *   reservation another run claimed; release only an unpaid one with a
 *   Dotypos reservation.
 * - `resume_stale`: from the current reservation, release a cancelled one as
 *   done, wait out a fresh `cancelling` one, take over a stale one, and claim
 *   the cancellation otherwise.
 * - `supersession`: claim a `held` reservation whose payment may be
 *   superseded.
 *
 * `liveStatus`, what the live Dotypos status must be:
 * - `unchecked`: cancel without reading it.
 * - `require_new`: read it after the claim; cancel `NEW`, take `CANCELLED` as
 *   released, refuse anything else.
 * - `read_before_claim`: read it before the claim; refuse anything but `NEW`
 *   and `CANCELLED` without touching the reservation, and cancel only `NEW`.
 *
 * `markerRefused`, what a cancelled marker the reservation's state refuses
 * means:
 * - `state_changed`: the run reports it.
 * - `confirm_cancelled`: another run finished the cancellation when the
 *   reservation reads `cancelled`; the refusal fails the release otherwise.
 * - `fails`: the refusal fails the release.
 */
type ReleasePolicy = {
  readonly failureCode: ReleaseFailureCode;
  readonly markerRefused: "state_changed" | "confirm_cancelled" | "fails";
} & (
  | {
      readonly claim: "resume_claimed" | "supersession";
      readonly liveStatus: "unchecked" | "require_new";
    }
  | {
      readonly claim: "resume_stale";
      readonly liveStatus: "read_before_claim";
    }
);

const releasePolicies = {
  hold_expired: {
    claim: "resume_claimed",
    liveStatus: "unchecked",
    failureCode: "dotypos_cancel_failed",
    markerRefused: "state_changed",
  },
  late_payment: {
    claim: "resume_stale",
    liveStatus: "read_before_claim",
    failureCode: "dotypos_cancel_failed",
    markerRefused: "confirm_cancelled",
  },
  agent_rotated: {
    claim: "supersession",
    liveStatus: "require_new",
    failureCode: "checkout_supersession_cancel_failed",
    markerRefused: "fails",
  },
} as const satisfies Record<UnpaidHoldReleaseReason, ReleasePolicy>;

/**
 * Local states whose Dotypos hold may still exist, as late-payment recovery
 * finds them before it releases the hold.
 */
const releasableReservationStates: ReadonlySet<string> = new Set([
  "held",
  "hold_expired",
  "cancellation_failed",
  "cancelling",
]);

/**
 * A `cancelling` reservation untouched for this long belongs to an
 * interrupted run, so a `resume_stale` release may finish it instead of
 * waiting indefinitely.
 */
const staleHoldCancellationAfter = Temporal.Duration.from({ minutes: 10 });

/** A fresh `cancelling` reservation belongs to a run that is still going. */
const isHoldCancellationFresh = (reservation: WorkspaceReservation) =>
  Temporal.Instant.compare(
    reservation.updatedAt,
    Temporal.Now.instant().subtract(staleHoldCancellationAfter)
  ) > 0;

/** A claimed hold, with the live status read before the claim, if any. */
interface ClaimedHold {
  readonly reservation: WorkspaceReservation;
  readonly dotyposReservationId: DotyposReservationId;
  readonly statusBeforeClaim?: "NEW" | "CANCELLED";
}

/** A hold this run claimed, or the outcome that ended the release first. */
type ClaimResult =
  | ClaimedHold
  | Exclude<UnpaidHoldReleaseOutcome, ReleasedHold | "state_changed">;

const isClaimedHold = (result: ClaimResult): result is ClaimedHold =>
  !Predicate.isString(result) && "reservation" in result;

interface IUnpaidHoldRelease {
  /**
   * Releases an unpaid reservation hold for a reason: claims the
   * reservation's cancellation, releases its Dotypos hold under the reason's
   * live-status rule, and marks the reservation cancelled. A hold left in
   * Dotypos after the claim moves the reservation to `cancellation_failed`
   * with the reason's stored code, and a Dotypos failure fails the release
   * after that marker.
   */
  readonly release: (
    request: UnpaidHoldReleaseRequest
  ) => Effect.Effect<UnpaidHoldReleaseOutcome, UnpaidHoldReleaseError>;
}

export class UnpaidHoldRelease extends Context.Service<
  UnpaidHoldRelease,
  IUnpaidHoldRelease
>()("UnpaidHoldRelease") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const dotypos = yield* DotyposService;
      const holdRelease = yield* DotyposHoldRelease;

      // Claims the cancellation, or takes over a `cancelling` reservation
      // another run claimed; unreleasable after logging why it may not be
      // released.
      const claimResumingClaimed = Effect.fnUntraced(function* (
        reservationId: WorkspaceReservationId
      ): Effect.fn.Return<ClaimResult, UnpaidHoldReleaseError> {
        const claimedFromNew =
          yield* reservations.claimCancellation(reservationId);
        yield* Effect.logDebug(
          "Reservation hold cancellation claim completed",
          { claimedFromNew: claimedFromNew !== null }
        );
        const claimed =
          claimedFromNew ?? (yield* reservations.findById(reservationId));
        if (claimed?.reservationState !== "cancelling") {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: claim not cancellable"
          );
          return "unreleasable" as const;
        }
        if (!claimed.dotyposReservationId) {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: missing Dotypos reservation"
          );
          return "unreleasable" as const;
        }
        if (claimed.paymentState === "paid") {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: reservation paid"
          );
          return "unreleasable" as const;
        }
        return {
          reservation: claimed,
          dotyposReservationId: claimed.dotyposReservationId,
        } satisfies ClaimedHold;
      });

      const claimSupersession = Effect.fnUntraced(function* (
        reservationId: WorkspaceReservationId
      ): Effect.fn.Return<ClaimResult, UnpaidHoldReleaseError> {
        const claimed =
          yield* reservations.claimSupersessionCancellation(reservationId);
        if (!claimed) return "unclaimed" as const;
        // workspace_reservations_hold_id_check rejects a cancelling row
        // without its Dotypos hold, so a claimed row always carries one.
        if (!claimed.dotyposReservationId) return "unreleasable" as const;
        return {
          reservation: claimed,
          dotyposReservationId: claimed.dotyposReservationId,
        } satisfies ClaimedHold;
      });

      // Reads the live status before the claim, so a hold Dotypos no longer
      // keeps pending leaves the reservation untouched.
      const claimResumingStale = Effect.fnUntraced(function* (
        reservationId: WorkspaceReservationId
      ): Effect.fn.Return<ClaimResult, UnpaidHoldReleaseError> {
        const reservation = yield* reservations.findById(reservationId);
        if (!reservation) {
          return yield* Effect.die(
            "Unpaid hold release reservation disappeared before release."
          );
        }
        if (reservation.reservationState === "cancelled") {
          return "already_released" as const;
        }
        if (
          !(
            releasableReservationStates.has(reservation.reservationState) &&
            reservation.dotyposReservationId
          )
        ) {
          return "unreleasable" as const;
        }
        const resumesStaleCancellation =
          reservation.reservationState === "cancelling";
        if (resumesStaleCancellation && isHoldCancellationFresh(reservation)) {
          return "in_progress" as const;
        }

        const status = yield* dotypos.getReservationStatus(
          reservation.dotyposReservationId
        );
        if (status !== "NEW" && status !== "CANCELLED") {
          return { refused: status } satisfies RefusedHold;
        }
        if (
          !resumesStaleCancellation &&
          !(yield* reservations.claimCancellation(reservation.id))
        ) {
          return "unclaimed" as const;
        }
        return {
          reservation,
          dotyposReservationId: reservation.dotyposReservationId,
          statusBeforeClaim: status,
        } satisfies ClaimedHold;
      });

      const claimHold = {
        resume_claimed: claimResumingClaimed,
        resume_stale: claimResumingStale,
        supersession: claimSupersession,
      } satisfies Record<
        ReleasePolicy["claim"],
        (
          reservationId: WorkspaceReservationId
        ) => Effect.Effect<ClaimResult, UnpaidHoldReleaseError>
      >;

      // Releases the claimed hold in Dotypos: a refusal when its live status
      // keeps it there, nothing when it may be marked cancelled.
      const releaseDotyposHold = (
        policy: ReleasePolicy,
        claimed: ClaimedHold
      ) => {
        if (claimed.statusBeforeClaim === "CANCELLED") return Effect.void;
        return holdRelease
          .release({
            reservationId: claimed.reservation.id,
            dotyposReservationId: claimed.dotyposReservationId,
            liveStatus:
              policy.liveStatus === "require_new" ? "require_new" : "unchecked",
            failureCode: policy.failureCode,
          })
          .pipe(
            Effect.map((outcome) =>
              Predicate.isString(outcome) ? undefined : outcome
            )
          );
      };

      // Marks the released hold cancelled; a marker the reservation's state
      // refuses is settled under the policy.
      const markReleased = Effect.fnUntraced(function* (
        policy: ReleasePolicy,
        claimed: ClaimedHold,
        holdExpiry: { readonly holdExpiredAt?: Temporal.Instant }
      ) {
        const cancelledAt = Temporal.Now.instant();
        return yield* reservations
          .markCancelled({
            id: claimed.reservation.id,
            cancelledAt,
            ...holdExpiry,
          })
          .pipe(
            Effect.as<UnpaidHoldReleaseOutcome>({
              released: claimed.reservation,
              cancelledAt,
            }),
            Effect.catchTag(
              "WorkspaceReservationStateError",
              Effect.fnUntraced(function* (refusal) {
                if (policy.markerRefused === "state_changed") {
                  return "state_changed" as const;
                }
                if (policy.markerRefused === "confirm_cancelled") {
                  const current = yield* reservations.findById(
                    claimed.reservation.id
                  );
                  if (current?.reservationState === "cancelled") {
                    return "already_released" as const;
                  }
                }
                return yield* refusal;
              })
            )
          );
      });

      return UnpaidHoldRelease.of({
        release: Effect.fn("unpaidHoldRelease.release")(function* (request) {
          yield* Effect.annotateCurrentSpan({ reason: request.reason });
          const policy: ReleasePolicy = releasePolicies[request.reason];
          const claimed = yield* claimHold[policy.claim](request.reservationId);
          if (!isClaimedHold(claimed)) return claimed;
          const refused = yield* releaseDotyposHold(policy, claimed);
          if (refused) return refused;
          return yield* markReleased(
            policy,
            claimed,
            // Only cleanup records when it found the hold expired; the other
            // reasons leave the column untouched.
            request.reason === "hold_expired"
              ? { holdExpiredAt: request.holdExpiredAt }
              : {}
          );
        }),
      });
    })
  ).pipe(Layer.provide(DotyposHoldRelease.Default));
}
