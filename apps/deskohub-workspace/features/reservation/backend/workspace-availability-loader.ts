import { Effect, Exit, Layer } from "effect";
import { openPayState } from "@/features/checkout/backend/checkout/pay-state";
import { recoverReplacementPayState } from "@/features/checkout/backend/checkout/replacement-pay-state";
import { ReservationSupersessionService } from "@/features/checkout/backend/checkout/reservation-supersession.service";
import type {
  MeetingRoomStartTimesQuery,
  PreloadedWorkspaceAvailability,
  WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { pagePreload } from "./page-preload";
import { WorkspaceAvailabilityService } from "./workspace-availability.service";
import { recoverReplacementOccupancyExclusion } from "./workspace-availability-replacement";

/** The services availability loads with replacement exclusion depend on. */
export const WorkspaceAvailabilityLoaderLive = Layer.merge(
  WorkspaceAvailabilityService.Live,
  ReservationSupersessionService.Live
);

/**
 * The occupancy a replacement may ignore: only the verified current hold of
 * the signed Pay state being replaced, and only for the same reservation kind.
 * An invalid or foreign replacement excludes nothing; the effect fails only
 * when the current hold cannot be looked up.
 */
const verifyReplacementOccupancyExclusion = Effect.fn(
  "workspaceAvailability.verifyReplacementOccupancyExclusion"
)(function* ({
  kind,
  replacementToken,
}: {
  readonly kind: WorkspaceAvailabilityQuery["kind"];
  readonly replacementToken?: string;
}) {
  const token = replacementToken?.trim();
  if (!token) return undefined;

  const state = yield* openPayState(token).pipe(recoverReplacementPayState);
  if (!state || state.reservation.kind !== kind) return undefined;

  const supersessions = yield* ReservationSupersessionService;
  return yield* supersessions
    .findCurrent({
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
    })
    .pipe(
      Effect.map((reservation) =>
        reservation
          ? { dotyposReservationId: reservation.dotyposReservationId }
          : undefined
      )
    );
});

/**
 * Advisory availability for one query, excluding a verified replacement.
 * While the replacement's hold cannot be looked up it loads ordinary
 * availability.
 */
export const loadAvailability = Effect.fn("workspaceAvailability.load")(
  function* ({
    query,
    replacementToken,
  }: {
    readonly query: WorkspaceAvailabilityQuery;
    readonly replacementToken?: string;
  }) {
    const occupancyExclusion = yield* verifyReplacementOccupancyExclusion({
      kind: query.kind,
      replacementToken,
    }).pipe(recoverReplacementOccupancyExclusion);
    const service = yield* WorkspaceAvailabilityService;
    return yield* service.getAvailability({ query, occupancyExclusion });
  }
);

/**
 * Advisory free meeting-room starts for one date, excluding a verified
 * replacement like `loadAvailability`.
 */
export const loadMeetingRoomStartTimes = Effect.fn(
  "workspaceAvailability.loadMeetingRoomStartTimes"
)(function* ({
  query,
  replacementToken,
}: {
  readonly query: MeetingRoomStartTimesQuery;
  readonly replacementToken?: string;
}) {
  const occupancyExclusion = yield* verifyReplacementOccupancyExclusion({
    kind: query.kind,
    replacementToken,
  }).pipe(recoverReplacementOccupancyExclusion);
  const service = yield* WorkspaceAvailabilityService;
  return yield* service.getMeetingRoomStartTimes({ query, occupancyExclusion });
});

type AvailabilityPreload = {
  readonly queries: ReadonlyArray<WorkspaceAvailabilityQuery>;
  readonly replacementToken?: string;
};

/**
 * Availability for the queries a reservation page renders first. A query that
 * fails is omitted for the client to load, so the page never fails on it.
 * All queries share one page kind and replacement.
 */
export const preloadAvailability = Effect.fn("workspaceAvailability.preload")(
  function* ({ queries, replacementToken }: AvailabilityPreload) {
    const [firstQuery] = queries;
    if (!firstQuery) return [];

    // Without the replacement's hold the page would show the customer's own
    // hold as occupied, so it leaves every query to the client, which retries
    // the lookup.
    const exclusionExit = yield* verifyReplacementOccupancyExclusion({
      kind: firstQuery.kind,
      replacementToken,
    }).pipe(Effect.exit);
    if (Exit.isFailure(exclusionExit)) {
      yield* Effect.logWarning(
        "Preloaded workspace availability could not verify the replacement; the client loads it",
        { cause: exclusionExit.cause, kind: firstQuery.kind }
      );
      return [];
    }
    const occupancyExclusion = exclusionExit.value;
    const service = yield* WorkspaceAvailabilityService;
    const results = yield* Effect.forEach(
      queries,
      (query) =>
        service.getAvailability({ query, occupancyExclusion }).pipe(
          Effect.exit,
          Effect.tap((exit) =>
            Exit.isFailure(exit)
              ? Effect.logWarning(
                  "Preloaded workspace availability failed; the client loads it",
                  { cause: exit.cause, kind: query.kind }
                )
              : Effect.void
          ),
          Effect.map(
            Exit.match({
              onFailure: () => [],
              onSuccess: (
                availability
              ): Array<PreloadedWorkspaceAvailability> => [
                { query, availability, loadedAt: Date.now() },
              ],
            })
          )
        ),
      { concurrency: "unbounded" }
    );

    return results.flat();
  }
);

/**
 * The page's availability preload with its live services, bounded by the page
 * preload deadline. Nothing it fails or runs late on, including building those
 * services, fails the page: the client loads whatever is missing.
 */
export const preloadPageAvailability = (input: AvailabilityPreload) =>
  preloadAvailability(input).pipe(
    Effect.provide(WorkspaceAvailabilityLoaderLive),
    Effect.scoped,
    pagePreload("workspace availability")
  );
