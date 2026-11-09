import {
  type DotyposReservationId,
  type DotyposReservationStatus,
  DotyposService,
  type DotyposWriteFailure,
} from "@deskohub/dotypos";
import { Context, Effect, Layer, Predicate } from "effect";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

/**
 * The `failure_code` a reservation keeps when its Dotypos hold wasn't
 * released. Stored values: the administration refund-attention queue reads
 * them, so never rename one.
 */
type DotyposHoldReleaseFailureCode =
  | "dotypos_cancel_failed"
  | "checkout_supersession_cancel_failed";

/**
 * What a release requires of the live Dotypos status before it cancels:
 *
 * - `require_new`: read it, cancel only `NEW`, take `CANCELLED` as already
 *   released, and refuse any other status. Session supersession.
 * - `unchecked`: cancel without reading it. Hold cleanup cancels every hold it
 *   claims, and late payment read `NEW` itself before claiming.
 */
type DotyposHoldLiveStatusRule = "require_new" | "unchecked";

/** A release that left the hold in Dotypos because of its live status. */
interface DotyposHoldRefusal {
  readonly refused: DotyposReservationStatus;
}

type DotyposHoldReleaseOutcome =
  | "cancelled"
  | "already_cancelled"
  | DotyposHoldRefusal;

interface IDotyposHoldRelease {
  /**
   * Releases the Dotypos hold of a reservation the caller has claimed for
   * cancellation. A hold it leaves in Dotypos (a failed status read, a refused
   * status, or a failed cancellation) first moves the reservation to
   * `cancellation_failed` with `failureCode`. The claim and the local
   * cancellation stay with the caller.
   */
  readonly release: (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly dotyposReservationId: DotyposReservationId;
    readonly liveStatus: DotyposHoldLiveStatusRule;
    readonly failureCode: DotyposHoldReleaseFailureCode;
  }) => Effect.Effect<DotyposHoldReleaseOutcome, DotyposWriteFailure>;
}

export class DotyposHoldRelease extends Context.Service<
  DotyposHoldRelease,
  IDotyposHoldRelease
>()("DotyposHoldRelease") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const dotypos = yield* DotyposService;

      // A failed marker is logged and dropped: the caller keeps the Dotypos
      // outcome, and the claim stays `cancelling` for a later run.
      const markReleaseFailed = (input: {
        readonly reservationId: WorkspaceReservationId;
        readonly failureCode: DotyposHoldReleaseFailureCode;
      }) =>
        reservations
          .markCancellationFailed({
            id: input.reservationId,
            failureCode: input.failureCode,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logError(
                "Reservation cancellation failure marker failed",
                {
                  orderId: input.reservationId,
                  failureCode: input.failureCode,
                  cause,
                }
              )
            ),
            Effect.ignore
          );

      const releaseUnderRule = Effect.fnUntraced(function* (input: {
        readonly dotyposReservationId: DotyposReservationId;
        readonly liveStatus: DotyposHoldLiveStatusRule;
      }) {
        if (input.liveStatus === "require_new") {
          const status = yield* dotypos.getReservationStatus(
            input.dotyposReservationId
          );
          if (status === "CANCELLED") return "already_cancelled" as const;
          if (status !== "NEW") {
            return { refused: status } satisfies DotyposHoldRefusal;
          }
        }
        yield* dotypos.cancelReservation(input.dotyposReservationId);
        return "cancelled" as const;
      });

      return DotyposHoldRelease.of({
        release: Effect.fn("dotyposHoldRelease.release")(function* (input) {
          const outcome = yield* releaseUnderRule(input).pipe(
            Effect.tapError(() => markReleaseFailed(input))
          );
          if (!Predicate.isString(outcome)) {
            yield* markReleaseFailed(input);
          }
          return outcome;
        }),
      });
    })
  );
}
