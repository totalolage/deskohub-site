import type {
  CustomerOrderState,
  CustomerOrderStatus,
} from "@deskohub/workspace-customer-api";
import { type Cause, Effect, Option, Queue, Ref, Result, Stream } from "effect";
import { allowsAutomaticRefresh } from "../../customer-api/account-read-budget";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import {
  AutomaticRefresh,
  type AutomaticRefreshStop,
  nextAutomaticRefresh,
  readSettlesOrder,
  type StatusVisit,
} from "./status-refresh-rules";

/** What the status screen shows while it keeps an order up to date. */
export interface StatusRefreshState {
  /** The order as last read. */
  readonly order: CustomerOrderState;
  /** A read is under way. */
  readonly reading: boolean;
  /** When the screen reads the order again on its own, or why it stopped. */
  readonly automatic: AutomaticRefresh;
  /** The automatic reads made since the screen came into view. */
  readonly attempt: number;
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
  /**
   * Where an interrupted run of the same screen visit left off (the app went
   * to the background): it continues without a new first read, keeps the
   * automatic reads already made, and stays stopped if it had stopped.
   */
  readonly resume: Option.Option<StatusRefreshState>;
  /**
   * The order's status as an earlier visit session showed it (the screen
   * lost focus and came back), if one did; a fresh run's first read compares
   * with it.
   */
  readonly previousStatus: Option.Option<CustomerOrderStatus>;
  /**
   * Runs after each read that settles the order (`readSettlesOrder`), before
   * the screen shows it: what other screens read of the order while it was
   * settling, such as the reservations list, is out of date.
   */
  readonly onSettled: Effect.Effect<void, never, R>;
}

const stopReasonOf = (failure: CustomerViewError): AutomaticRefreshStop =>
  CustomerViewError.$is("RateLimited")(failure) ? "limited" : "failed";

const firstState = (order: CustomerOrderState): StatusRefreshState => ({
  order,
  reading: false,
  automatic: AutomaticRefresh.Stopped({ reason: "settled" }),
  attempt: 0,
  failure: Option.none(),
});

// A run interrupted mid-read has no read under way any more.
const resumedState = (state: StatusRefreshState): StatusRefreshState => ({
  ...state,
  reading: false,
});

/**
 * Reads an order and keeps it up to date while the screen is in view: the
 * first read decides whether the screen shows the order at all (its failure
 * fails the stream), then the screen reads again on the visit's schedule
 * until the order settles, the budget runs low, the schedule is used up or a
 * read fails, and after that only when the customer asks. A manual refresh
 * never restarts automatic refreshes. Interrupting the stream cancels the
 * pending wait or read; `resume` continues from where it stopped.
 */
export const statusRefreshes = <R>(
  input: StatusRefreshInput<R>
): Stream.Stream<StatusRefreshState, CustomerRequestFailure, R> =>
  Stream.unwrap(
    Option.match(input.resume, {
      onNone: () =>
        input.read.pipe(
          Effect.tap((order) =>
            settledBy(input, input.previousStatus, order.status)
          ),
          Effect.map(firstState)
        ),
      onSome: (state) => Effect.succeed(resumedState(state)),
    }).pipe(
      Effect.map((start) =>
        Stream.callback<StatusRefreshState, never, R>((queue) =>
          Effect.flatMap(Ref.make(start), (current) =>
            refreshLoop(input, current, queue)
          )
        )
      )
    )
  );

// Runs `onSettled` when a read that found `status` settled the order.
const settledBy = <R>(
  input: StatusRefreshInput<R>,
  previous: Option.Option<CustomerOrderStatus>,
  status: CustomerOrderStatus
): Effect.Effect<void, never, R> =>
  readSettlesOrder({ visit: input.visit, previous, status })
    ? input.onSettled
    : Effect.void;

const refreshLoop = <R>(
  input: StatusRefreshInput<R>,
  current: Ref.Ref<StatusRefreshState>,
  queue: Queue.Queue<StatusRefreshState, Cause.Done>
) => {
  const publish = (change: (state: StatusRefreshState) => StatusRefreshState) =>
    Effect.flatMap(Ref.updateAndGet(current, change), (state) =>
      Queue.offer(queue, state)
    );

  const stop = (reason: AutomaticRefreshStop) =>
    publish((state) => ({
      ...state,
      automatic: AutomaticRefresh.Stopped({ reason }),
    }));

  // Marks the read, runs it and keeps the order or the failure; answers the
  // failure so the caller can stop.
  const readOnce = publish((state) => ({ ...state, reading: true })).pipe(
    Effect.andThen(Effect.result(input.read)),
    Effect.tap(
      Result.match({
        onSuccess: (order) =>
          Effect.flatMap(Ref.get(current), (shown) =>
            settledBy(input, Option.some(shown.order.status), order.status)
          ),
        onFailure: () => Effect.void,
      })
    ),
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

  // One automatic read, unless the budget ran low while waiting for it. The
  // read counts as soon as it starts, so a run interrupted mid-read (the app
  // went to the background) resumes with the read it already spent.
  const automaticRead = (attempt: number): Effect.Effect<void, never, R> =>
    Effect.flatMap(input.remainingBudget, (remaining) =>
      allowsAutomaticRefresh(remaining)
        ? publish((state) => ({ ...state, attempt: attempt + 1 })).pipe(
            Effect.andThen(readOnce),
            Effect.flatMap(
              Option.match({
                onNone: () => automaticFrom(attempt + 1),
                onSome: (failure) => stop(stopReasonOf(failure)),
              })
            )
          )
        : stop("budget")
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
            Effect.sleep(delay).pipe(Effect.andThen(automaticRead(attempt))),
        })
      )
    );

  // A fresh run schedules from the start; a resumed one continues its count,
  // or, when it had stopped, shows where it stopped and waits for taps.
  const automaticRefreshes = Effect.flatMap(Ref.get(current), (start) =>
    Option.match(input.resume, {
      onNone: () => automaticFrom(0),
      onSome: () =>
        AutomaticRefresh.$match(start.automatic, {
          Stopped: () => publish(resumedState),
          After: () => automaticFrom(start.attempt),
        }),
    })
  );

  return automaticRefreshes.pipe(
    Effect.andThen(
      Stream.runForEach(input.manualRequests, () => Effect.asVoid(readOnce))
    )
  );
};
