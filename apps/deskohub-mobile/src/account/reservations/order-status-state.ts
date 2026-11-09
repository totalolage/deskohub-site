import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Cause, Effect, Option, Stream } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { AccountReadBudget } from "../../customer-api/account-read-budget";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import { appForegroundAtom } from "../../platform/app-foreground";
import { reservationHistoryAtom } from "./reservations-list-state";
import { type StatusRefreshState, statusRefreshes } from "./status-refresh";
import { AutomaticRefresh, type StatusVisit } from "./status-refresh-rules";

/** One status read: the server refreshes the order and it spends the budget. */
export const readOrderStatus = (orderId: CustomerReservationOrderId) =>
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.reservations.getReservationStatus({ params: { orderId } })
  ).pipe(customerRead({ accountRead: true }));

/** The advisory number of reads left. */
export const remainingReadBudget = Effect.flatMap(
  Effect.service(AccountReadBudget),
  (budget) => budget.remaining
);

// The refresh taps after the atom computed: counts above the one it saw then.
// The subscription starts only once the stream reaches its manual phase, and
// `toStream` then emits the current count first, so a tap made before that
// still counts.
const refreshTaps = (
  registry: AtomRegistry.AtomRegistry,
  counter: Atom.Atom<number>
) => {
  const seen = registry.get(counter);
  return AtomRegistry.toStream(registry, counter).pipe(
    Stream.filter((taps) => taps > seen)
  );
};

/** Where the order's status screen is: whether it is focused, and since when. */
export interface StatusScreenFocus {
  /** Counts the times the screen came into focus; each one is a new session. */
  readonly session: number;
  readonly focused: boolean;
  /** How the customer arrived, which picks the automatic refresh schedule. */
  readonly visit: StatusVisit;
}

const unfocused: StatusScreenFocus = {
  session: 0,
  focused: false,
  visit: "normal",
};

/** The screen came into focus for a `visit`: a new session starts. */
export const focusGained =
  (visit: StatusVisit) =>
  (focus: StatusScreenFocus): StatusScreenFocus => ({
    session: focus.session + 1,
    focused: true,
    visit,
  });

/** The screen lost focus; its session ends. */
export const focusLost = (focus: StatusScreenFocus): StatusScreenFocus => ({
  ...focus,
  focused: false,
});

// The refresh state and the focus session it belongs to.
interface StatusProgress {
  readonly session: number;
  readonly state: StatusRefreshState;
}

// A stream atom fails with NoSuchElementError when its stream ends without a
// value; these refreshes never end, so that would be a defect.
const endedAsDefect = <E>(
  cause: Cause.Cause<E | Cause.NoSuchElementError>
): Cause.Cause<E> =>
  Cause.fromReasons(
    cause.reasons.map((reason): Cause.Reason<E> => {
      if (!Cause.isFailReason(reason)) return reason;
      const { error } = reason;
      return Cause.isNoSuchElementError(error)
        ? Cause.makeDieReason(error)
        : Cause.makeFailReason(error);
    })
  );

// What the screen shows of the refreshes in focus session `session`:
// - A stream atom reports every value as waiting until the stream ends,
//   which this one never does; the screen waits only while a read is under
//   way, or while a new session's first read is (the state shown is then
//   the previous session's, marked as reading so Refresh stays disabled).
// - A new session whose first read failed keeps showing the previous
//   session's order under the failure, stopped: refreshing it means retrying
//   the session, not tapping a stream that has ended.
const shownProgress = <E>(
  result: AsyncResult.AsyncResult<StatusProgress, E | Cause.NoSuchElementError>,
  session: number
): AsyncResult.AsyncResult<StatusRefreshState, E> =>
  AsyncResult.match(result, {
    onInitial: ({ waiting }) =>
      AsyncResult.initial<StatusRefreshState, E>(waiting),
    onSuccess: ({ value }) => {
      const reading = value.state.reading || value.session !== session;
      return AsyncResult.success<StatusRefreshState, E>(
        { ...value.state, reading },
        { waiting: reading }
      );
    },
    onFailure: ({ cause, previousSuccess, waiting }) =>
      AsyncResult.failure<StatusRefreshState, E>(endedAsDefect(cause), {
        previousSuccess: Option.map(previousSuccess, ({ value }) =>
          AsyncResult.success<StatusRefreshState, E>({
            ...value.state,
            // A retry of the visit is under way.
            reading: waiting,
            automatic: AutomaticRefresh.Stopped({ reason: "failed" }),
          })
        ),
        waiting,
      }),
  });

/**
 * The status screen's atoms, over `foreground` (whether the app is in the
 * foreground) so tests can send the app to the background.
 */
export const makeOrderStatusAtoms = (foreground: Atom.Atom<boolean>) => {
  // One-level families keyed by the order id only: a family holds its values
  // weakly, so a nested family (say, per visit) could be collected and hand
  // out a new atom, restarting the refreshes.

  /** The order's status screen focus; the screen's focus effect sets it. */
  const focus = Atom.family((_orderId: CustomerReservationOrderId) =>
    Atom.make(unfocused)
  );

  /** Counts the customer's refresh taps on the order's status screen. */
  const refreshRequests = Atom.family((_orderId: CustomerReservationOrderId) =>
    Atom.make(0)
  );

  // Refreshes run while the screen is focused and the app is in the
  // foreground. Leaving either recomputes the atom, which interrupts them (a
  // pending wait or read) and keeps the last state. Back in the foreground
  // during the same session, they continue where they stopped; a new session
  // starts over with a fresh read and a new automatic count.
  const progress = Atom.family((orderId: CustomerReservationOrderId) =>
    customerDataRuntime.atom((get) => {
      const { session, focused, visit } = get(focus(orderId));
      const previous = get
        .self<AsyncResult.AsyncResult<StatusProgress, unknown>>()
        .pipe(Option.flatMap(AsyncResult.value));
      const resume = previous.pipe(
        Option.filter((previous) => previous.session === session),
        Option.map((previous) => previous.state)
      );
      return focused && get(foreground)
        ? statusRefreshes({
            read: readOrderStatus(orderId),
            remainingBudget: remainingReadBudget,
            visit,
            manualRequests: refreshTaps(get.registry, refreshRequests(orderId)),
            resume,
            previousStatus: Option.map(
              previous,
              (previous) => previous.state.order.status
            ),
            // The list read the order while it was settling.
            onSettled: Effect.sync(() => get.refresh(reservationHistoryAtom)),
          }).pipe(Stream.map((state) => ({ session, state })))
        : Stream.never;
    })
  );

  /** The order as the status screen shows it, kept up to date while in view. */
  const status = Atom.family((orderId: CustomerReservationOrderId) =>
    Atom.make((get) =>
      shownProgress(get(progress(orderId)), get(focus(orderId)).session)
    )
  );

  return { focus, refreshRequests, progress, status };
};

export const orderStatusAtoms = makeOrderStatusAtoms(appForegroundAtom);
