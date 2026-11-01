import { Duration, Effect, Option, Ref, Schedule } from "effect";
import {
  type DotyposConditionalWriteFailure,
  type DotyposReadFailure,
  type DotyposRequest,
  type DotyposUnavailable,
  DotyposUncertain,
  type DotyposWriteFailure,
} from "../errors";

/**
 * How one Dotypos request behaves, and so how far the package may retry it.
 * The union makes the forbidden combinations unrepresentable: no transient or
 * replay ceiling on an unsafe write, no creation ceiling on a read.
 *
 * - `effect`: whether the request can change Dotypos state.
 * - `repeat`: `conditional` (If-Match makes a duplicate application fail with
 *   412), `idempotent` (a repeated PUT of the same fields converges), or
 *   `unsafe` (a repeated create duplicates).
 * - `retry`: the retry ceiling.
 */
export type DotyposRequestProfile =
  | {
      readonly effect: "read";
      readonly repeat: "safe";
      readonly retry: "transient" | "none";
    }
  | {
      readonly effect: "write";
      readonly repeat: "conditional" | "idempotent";
      readonly retry: "replay" | "none";
    }
  | {
      readonly effect: "write";
      readonly repeat: "unsafe";
      readonly retry: "creation" | "none";
    };

const transientRead = {
  effect: "read",
  repeat: "safe",
  retry: "transient",
} as const satisfies DotyposRequestProfile;
const singleRead = {
  effect: "read",
  repeat: "safe",
  retry: "none",
} as const satisfies DotyposRequestProfile;
const conditionalWrite = {
  effect: "write",
  repeat: "conditional",
  retry: "replay",
} as const satisfies DotyposRequestProfile;

/** Every request the package sends, with its profile. Package-private. */
export const dotyposRequestProfiles = {
  "reservation.get": transientRead,
  "reservation.status": transientRead,
  "reservation.create": {
    effect: "write",
    repeat: "unsafe",
    retry: "creation",
  },
  "reservation.version": transientRead,
  "reservation.patch": conditionalWrite,
  "reservation.delete": { effect: "write", repeat: "unsafe", retry: "none" },
  "customer.get": transientRead,
  "customer.version": transientRead,
  "customer.patch": conditionalWrite,
  "customer.fill": { effect: "write", repeat: "idempotent", retry: "replay" },
  "customer.create": { effect: "write", repeat: "unsafe", retry: "none" },
  "customer.createAfterLookup": {
    effect: "write",
    repeat: "unsafe",
    retry: "creation",
  },
  "customers.page": singleRead,
  "customers.changes": singleRead,
  "customers.search": transientRead,
  "customers.lookup": transientRead,
  "discountGroup.get": transientRead,
  "discountGroups.list": transientRead,
  "tables.list": transientRead,
  "reservations.list": transientRead,
  "reservations.page": singleRead,
  "products.list": transientRead,
  "categories.list": transientRead,
} as const satisfies Record<DotyposRequest, DotyposRequestProfile>;

type DotyposRequestProfiles = typeof dotyposRequestProfiles;

/** The failures one request can surface: reads are never uncertain, and only conditional writes conflict. */
export type DotyposRequestFailure<Request extends DotyposRequest> =
  DotyposRequestProfiles[Request] extends { readonly effect: "read" }
    ? DotyposReadFailure
    : DotyposRequestProfiles[Request] extends {
          readonly repeat: "conditional";
        }
      ? DotyposConditionalWriteFailure
      : DotyposWriteFailure;

/** One attempt's outcome, before stickiness and `Option` conversion. */
export type DotyposAttemptFailure = DotyposConditionalWriteFailure;

const replayableReasons: ReadonlySet<DotyposUncertain["reason"]> = new Set<
  DotyposUncertain["reason"]
>(["server", "transport", "timeout"]);
const creationReasons: ReadonlySet<DotyposUnavailable["reason"]> = new Set<
  DotyposUnavailable["reason"]
>(["rate-limited", "empty-response"]);

/** Each ceiling decides on the attempt's own outcome. */
const retryCeilings = {
  transient: (outcome: DotyposAttemptFailure) =>
    outcome._tag === "DotyposUnavailable",
  replay: (outcome: DotyposAttemptFailure) =>
    outcome._tag === "DotyposUnavailable" ||
    (outcome._tag === "DotyposUncertain" &&
      replayableReasons.has(outcome.reason)),
  creation: (outcome: DotyposAttemptFailure) =>
    outcome._tag === "DotyposUnavailable" &&
    creationReasons.has(outcome.reason),
  none: () => false,
} satisfies Record<
  DotyposRequestProfile["retry"],
  (outcome: DotyposAttemptFailure) => boolean
>;

const maxRetries = 3;

const retrySchedule = (
  shouldRetry: (outcome: DotyposAttemptFailure) => boolean
) =>
  Schedule.exponential("100 millis").pipe(
    Schedule.jittered,
    Schedule.while<DotyposAttemptFailure, Duration.Duration>(({ input }) =>
      shouldRetry(input)
    ),
    Schedule.both(Schedule.recurs(maxRetries)),
    Schedule.tapOutput(([delay, attempt]) =>
      Effect.logWarning(`Dotypos retry attempt #${attempt + 1}`, {
        attemptNumber: attempt + 1,
        delayMs: Duration.toMillis(delay),
        maxRetries,
      })
    )
  );

/**
 * Retries the request up to its profile's ceiling. A replayed write keeps the
 * first uncertain attempt's uncertainty (stickiness): once an attempt may have
 * applied the write, every later failure of the call is uncertain, and a later
 * version conflict becomes `conflict-after-replay`. The retry decision still
 * uses each attempt's own outcome, so stickiness never adds a retry.
 */
export const retryDotyposRequest =
  (request: DotyposRequest) =>
  <A, E extends DotyposAttemptFailure, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, R> => {
    const ceiling = dotyposRequestProfiles[request].retry;
    if (ceiling === "none") return effect;
    const schedule = retrySchedule(retryCeilings[ceiling]);
    if (ceiling !== "replay") return Effect.retry(effect, { schedule });

    return Ref.make(Option.none<DotyposUncertain>()).pipe(
      Effect.flatMap((firstUncertain) =>
        effect.pipe(
          Effect.tapError((outcome) =>
            recordFirstUncertain(firstUncertain, outcome)
          ),
          Effect.retry({ schedule }),
          Effect.catch((outcome) =>
            Ref.get(firstUncertain).pipe(
              Effect.flatMap((uncertain) =>
                // Replay rows are writes, whose failure union includes DotyposUncertain.
                Effect.fail(keepUncertainty(outcome, uncertain) as E)
              )
            )
          )
        )
      )
    );
  };

const recordFirstUncertain = (
  firstUncertain: Ref.Ref<Option.Option<DotyposUncertain>>,
  outcome: DotyposAttemptFailure
) =>
  outcome._tag === "DotyposUncertain"
    ? Ref.update(
        firstUncertain,
        Option.orElse(() => Option.some(outcome))
      )
    : Effect.void;

const keepUncertainty = (
  outcome: DotyposAttemptFailure,
  firstUncertain: Option.Option<DotyposUncertain>
): DotyposAttemptFailure =>
  Option.match(firstUncertain, {
    onNone: () => outcome,
    onSome: (uncertain) =>
      outcome._tag === "DotyposUncertain"
        ? outcome
        : new DotyposUncertain({
            operation: outcome.operation,
            request: outcome.request,
            httpStatus: outcome.httpStatus,
            reason:
              outcome._tag === "DotyposVersionConflict"
                ? "conflict-after-replay"
                : uncertain.reason,
            message: "An earlier attempt of this write may have applied it.",
            cause: outcome,
          }),
  });
