import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Effect, Stream } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import { DotyposReadBudget } from "../../customer-api/dotypos-read-budget";
import { appForegroundAtom } from "../../platform/app-foreground";
import type { StatusVisit } from "./status-refresh-rules";
import { statusRefreshes } from "./status-refresh";

/** One status read: the server refreshes the order and it spends the budget. */
export const readOrderStatus = (orderId: CustomerReservationOrderId) =>
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.reservations.getReservationStatus({ params: { orderId } })
  ).pipe(customerRead({ dotyposBacked: true }));

/** The advisory number of reads left. */
export const remainingReadBudget = Effect.flatMap(
  Effect.service(DotyposReadBudget),
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

/**
 * The status screen's atoms, over `foreground` (whether the app is in the
 * foreground) so tests can send the app to the background.
 */
export const makeOrderStatusAtoms = (foreground: Atom.Atom<boolean>) => {
  /** Whether the order's status screen is focused; the screen sets it. */
  const focused = Atom.family((_orderId: CustomerReservationOrderId) =>
    Atom.make(false)
  );

  /** Counts the customer's refresh taps on the order's status screen. */
  const refreshRequests = Atom.family((_orderId: CustomerReservationOrderId) =>
    Atom.make(0)
  );

  /**
   * The order kept up to date while its screen is focused and the app is in
   * the foreground. Leaving either recomputes the atom, which interrupts the
   * refreshes (a pending wait or read) and keeps the last state on screen;
   * coming back starts over with a fresh read and a new automatic count.
   */
  const status = Atom.family((orderId: CustomerReservationOrderId) =>
    Atom.family((visit: StatusVisit) =>
      customerDataRuntime.atom((get) =>
        get(focused(orderId)) && get(foreground)
          ? statusRefreshes({
              read: readOrderStatus(orderId),
              remainingBudget: remainingReadBudget,
              visit,
              manualRequests: refreshTaps(get.registry, refreshRequests(orderId)),
            })
          : Stream.never
      )
    )
  );

  return { focused, refreshRequests, status };
};

export const orderStatusAtoms = makeOrderStatusAtoms(appForegroundAtom);
