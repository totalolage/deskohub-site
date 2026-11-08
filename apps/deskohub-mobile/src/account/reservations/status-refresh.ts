import type { CustomerOrderState } from "@deskohub/workspace-customer-api";
import { type Cause, Effect, Option, Queue, Ref, Result, Stream } from "effect";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import {
  AutomaticRefresh,
  type StatusVisit,
  nextAutomaticRefresh,
} from "./status-refresh-rules";

/** What the status screen shows while it keeps an order up to date. */
export interface StatusRefreshState {
  /** The order as last read. */
  readonly order: CustomerOrderState;
  /** A read is under way. */
  readonly reading: boolean;
  /** When the screen reads the order again on its own, or why it stopped. */
  readonly automatic: AutomaticRefresh;
  /** Why the last read failed; the order shown is the one read before. */
  readonly failure: Option.Option<CustomerViewError>;
}

/** The customer may refresh once the screen has stopped refreshing itself. */
export const canRefreshManually = (state: StatusRefreshState) =>
  !state.reading && AutomaticRefresh.$is("Stopped")(state.automatic);

export interface StatusRefreshInput<R> {
  /** One status read; each one refreshes the order and spends the budget. */
  readonly read: Effect.Effect<CustomerOrderState, CustomerRequestFailure, R>;
  /** The advisory number of reads left. */
  readonly remainingBudget: Effect.Effect<number, never, R>;
  readonly visit: StatusVisit;
  /** The customer's refresh taps; honoured once automatic refreshes stop. */
  readonly manualRequests: Stream.Stream<unknown>;
}

const stopReasonOf = (failure: CustomerViewError) =>
  CustomerViewError.$is("RateLimited")(failure) ? "limited" : "failed";

/**
 * Reads an order and keeps it up to date while the screen is in view: the
 * first read decides whether the screen shows the order at all (its failure
 * fails the stream), then the screen reads again on the visit's schedule
 * until the order settles, the budget runs low, the schedule is used up or a
 * read fails, and after that only when the customer asks. A manual refresh
 * never restarts automatic refreshes; a new stream (the screen coming back
 * into view) does. Interrupting the stream cancels the pending wait or read.
 */
export const statusRefreshes = <R>(
  input: StatusRefreshInput<R>
): Stream.Stream<StatusRefreshState, CustomerRequestFailure, R> =>
  Stream.unwrap(
    Effect.map(input.read, (order) =>
      Stream.callback<StatusRefreshState, never, R>((queue) =>
        Effect.flatMap(
          Ref.make<StatusRefreshState>({
            order,
            reading: false,
            automatic: AutomaticRefresh.Stopped({ reason: "settled" }),
            failure: Option.none(),
          }),
          (current) => refreshLoop(input, current, queue)
        )
      )
    )
  );

const refreshLoop = <R>(
  input: StatusRefreshInput<R>,
  current: Ref.Ref<StatusRefreshState>,
  queue: Queue.Queue<StatusRefreshState, Cause.Done>
) => {
  const publish = (change: (state: StatusRefreshState) => StatusRefreshState) =>
    Effect.flatMap(Ref.updateAndGet(current, change), (state) =>
      Queue.offer(queue, state)
    );

  // Marks the read, runs it and keeps the order or the failure; answers the
  // failure so the caller can stop.
  const readOnce = publish((state) => ({ ...state, reading: true })).pipe(
    Effect.andThen(Effect.result(input.read)),
    Effect.map(
      Result.match({
        onSuccess: (order) => ({
          reading: false,
          order,
          failure: Option.none<CustomerViewError>(),
        }),
        onFailure: (failure) => ({
          reading: false,
          failure: Option.some(toCustomerViewError(failure)),
        }),
      })
    ),
    Effect.tap((change) => publish((state) => ({ ...state, ...change }))),
    Effect.map(({ failure }) => failure)
  );

  const automaticFrom = (attempt: number): Effect.Effect<void, never, R> =>
    Effect.Do.pipe(
      Effect.bind("remainingBudget", () => input.remainingBudget),
      Effect.bind("state", () => Ref.get(current)),
      Effect.let("next", ({ remainingBudget, state }) =>
        nextAutomaticRefresh({
          visit: input.visit,
          attempt,
          remainingBudget,
          status: state.order.status,
        })
      ),
      Effect.tap(({ next }) =>
        publish((state) => ({ ...state, automatic: next }))
      ),
      Effect.flatMap(({ next }) =>
        AutomaticRefresh.$match(next, {
          Stopped: () => Effect.void,
          After: ({ delay }) =>
            Effect.sleep(delay).pipe(
              Effect.andThen(readOnce),
              Effect.flatMap(
                Option.match({
                  onNone: () => automaticFrom(attempt + 1),
                  onSome: (failure) =>
                    publish((state) => ({
                      ...state,
                      automatic: AutomaticRefresh.Stopped({
                        reason: stopReasonOf(failure),
                      }),
                    })),
                })
              )
            ),
        })
      ),
      Effect.asVoid
    );

  return automaticFrom(0).pipe(
    Effect.andThen(
      Stream.runForEach(input.manualRequests, () => Effect.asVoid(readOnce))
    )
  );
};
