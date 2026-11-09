import {
  type ProviderPageCount,
  ProviderRetryPolicy,
} from "@deskohub/provider-request";
import { type Duration, Effect, Option, Ref } from "effect";
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

/**
 * Every retried Dotypos request backs off exponentially from 100 ms with
 * jitter, at most three times. Its profile's ceiling decides which outcomes
 * are retried; a `none` ceiling sends the request once.
 */
const dotyposRetryPolicy = ProviderRetryPolicy.make({
  label: "Dotypos",
  baseDelay: "100 millis",
  maxRetries: 3,
});

/** The Dotypos request policy of a deployment's per-attempt timeout. */
export const getDotyposRequestPolicy = (apiTimeout: Duration.Input) =>
  dotyposRetryPolicy.withAttemptTimeout(apiTimeout);

/**
 * The longest Dotypos requests can take when every attempt times out: `once`
 * for a request whose profile never retries, `retried` for any other, and
 * `sequential` for several in a row. `pagedLoad` bounds a paginated list
 * load: its profile's retries wrap the whole load, which keeps the pages it
 * has read, so each retry resends only the page that failed and all pages
 * share one retry budget. A load of an unknown page count has no finite
 * bound.
 */
export const getDotyposRequestWorstCase = (apiTimeout: Duration.Input) => {
  const { worstCase } = getDotyposRequestPolicy(apiTimeout);
  return {
    once: worstCase.once,
    retried: worstCase.retried,
    sequential: worstCase.sequential,
    pagedLoad: (pages: ProviderPageCount) =>
      worstCase.paginated({ pages, retry: "resume" }),
  };
};

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
    const retry = dotyposRetryPolicy.retryWhile(retryCeilings[ceiling]);
    if (ceiling !== "replay") return retry(effect);

    return Ref.make(Option.none<DotyposUncertain>()).pipe(
      Effect.flatMap((firstUncertain) =>
        effect.pipe(
          Effect.tapError((outcome) =>
            recordFirstUncertain(firstUncertain, outcome)
          ),
          retry,
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

/**
 * Keeps an earlier uncertain attempt's uncertainty on a later failure of the
 * same call. A version conflict becomes `conflict-after-replay`; any other
 * failure keeps the earlier reason. Without an earlier uncertainty the
 * failure stands.
 */
export const keepUncertainty = (
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
