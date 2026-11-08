import { describe, expect, test } from "bun:test";
import type {
  CustomerOrderStatus,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Effect, Exit, Fiber, Layer, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import { DotyposReadBudget } from "../../customer-api/dotypos-read-budget";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { sampleOrderIds } from "../../customer-api/testing/sample-fixtures";
import { eventually, quietly } from "../../testing/eventually";
import { readOrderStatus, remainingReadBudget } from "./order-status-state";
import {
  type StatusRefreshState,
  canRefreshManually,
  statusRefreshes,
} from "./status-refresh";
import { AutomaticRefresh, type StatusVisit } from "./status-refresh-rules";

const setOrderStatus = (
  workspace: FakeWorkspace,
  orderId: CustomerReservationOrderId,
  status: CustomerOrderStatus
) => {
  const order = workspace.data.orders.get(orderId);
  if (order === undefined) throw new Error(`no sample order ${orderId}`);
  workspace.data = {
    ...workspace.data,
    orders: new Map([
      ...workspace.data.orders,
      [orderId, { ...order, state: { ...order.state, status } }],
    ]),
  };
};

const statusReads = (workspace: FakeWorkspace) =>
  workspace.calls.filter((call) => call === "getReservationStatus").length;

const harness = ({
  visit = "normal",
  orderId = sampleOrderIds.pending,
}: {
  readonly visit?: StatusVisit;
  readonly orderId?: CustomerReservationOrderId;
} = {}) => {
  const workspace = FakeWorkspace.forKind("linked");
  const layer = Layer.mergeAll(
    fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
    TestClock.layer()
  );
  const states: Array<StatusRefreshState> = [];
  const last = () => states.at(-1);
  const reads = () => statusReads(workspace);
  /**
   * Settles once `count` reads were made and the stream reported each: every
   * read after the first is announced with a `reading` state.
   */
  const readsSettled = (count: number) =>
    eventually(
      () =>
        reads() === count &&
        states.filter((state) => state.reading).length === count - 1 &&
        last()?.reading === false
    );
  const run = <A, E>(
    script: (manual: Queue.Queue<void>) => Effect.Effect<A, E, DotyposReadBudget>
  ) =>
    Effect.gen(function* () {
      const manual = yield* Queue.unbounded<void>();
      const fiber = yield* statusRefreshes({
        read: readOrderStatus(orderId),
        remainingBudget: remainingReadBudget,
        visit,
        manualRequests: Stream.fromQueue(manual),
      }).pipe(
        Stream.runForEach((state) => Effect.sync(() => states.push(state))),
        Effect.forkChild
      );
      const outcome = yield* script(manual);
      yield* Fiber.interrupt(fiber);
      return outcome;
    }).pipe(Effect.provide(layer), Effect.runPromise);
  return { workspace, states, last, reads, readsSettled, run, orderId };
};

const stopped = (state: StatusRefreshState | undefined) =>
  state !== undefined && AutomaticRefresh.$is("Stopped")(state.automatic)
    ? state.automatic.reason
    : undefined;

describe("statusRefreshes", () => {
  test("a normal visit reads again after 10, 20 and 40 seconds, then stops", async () => {
    const h = harness();

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        yield* TestClock.adjust("9 seconds");
        yield* quietly;
        expect(h.reads()).toBe(1);
        yield* TestClock.adjust("1 second");
        yield* h.readsSettled(2);
        yield* TestClock.adjust("20 seconds");
        yield* h.readsSettled(3);
        yield* TestClock.adjust("40 seconds");
        yield* h.readsSettled(4);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.reads()).toBe(4);
    expect(stopped(h.last())).toBe("exhausted");
  });

  test("a visit after payment reads on the payment-return schedule", async () => {
    const h = harness({ visit: "after-payment" });

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        yield* TestClock.adjust("3 seconds");
        yield* h.readsSettled(2);
        yield* TestClock.adjust("3 seconds");
        yield* h.readsSettled(3);
        yield* TestClock.adjust("4 seconds");
        yield* quietly;
        expect(h.reads()).toBe(3);
        yield* TestClock.adjust("1 second");
        yield* h.readsSettled(4);
      })
    );
  });

  test("stops once the order settles", async () => {
    const h = harness();

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        setOrderStatus(h.workspace, h.orderId, "fulfilled");
        yield* TestClock.adjust("10 seconds");
        yield* h.readsSettled(2);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.reads()).toBe(2);
    expect(h.last()?.order.status).toBe("fulfilled");
    expect(stopped(h.last())).toBe("settled");
  });

  test("never schedules a read for an order that is already settled", async () => {
    const h = harness({ orderId: sampleOrderIds.fulfilled });

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.reads()).toBe(1);
    expect(stopped(h.last())).toBe("settled");
  });

  test("a 429 stops automatic reads and keeps the order on screen", async () => {
    const h = harness();

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        h.workspace.fail("getReservationStatus", "rate-limited");
        yield* TestClock.adjust("10 seconds");
        yield* h.readsSettled(2);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.reads()).toBe(2);
    expect(stopped(h.last())).toBe("limited");
    expect(h.last()?.failure).toEqual(
      Option.some(CustomerViewError.RateLimited())
    );
    expect(h.last()?.order.orderId).toBe(h.orderId);
  });

  test("any other failed automatic read stops automatic reads too", async () => {
    const h = harness();

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        h.workspace.fail("getReservationStatus", "service-unavailable");
        yield* TestClock.adjust("10 seconds");
        yield* h.readsSettled(2);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.reads()).toBe(2);
    expect(stopped(h.last())).toBe("failed");
  });

  test("stops when fewer than 8 reads are left", async () => {
    const h = harness();

    await h.run(() =>
      Effect.gen(function* () {
        const budget = yield* DotyposReadBudget;
        // 12 reads elsewhere; the screen's first read leaves 7.
        yield* Effect.repeat(budget.spend, { times: 11 });
        yield* h.readsSettled(1);
        yield* TestClock.adjust("1 minute");
        yield* quietly;
        expect(yield* budget.remaining).toBe(7);
      })
    );

    expect(h.reads()).toBe(1);
    expect(stopped(h.last())).toBe("budget");
  });

  test("the first read's failure fails the stream", async () => {
    const h = harness({
      orderId: "sample-order-missing" as CustomerReservationOrderId,
    });

    const exit = await Effect.runPromise(
      Effect.exit(
        statusRefreshes({
          read: readOrderStatus(h.orderId),
          remainingBudget: remainingReadBudget,
          visit: "normal",
          manualRequests: Stream.never,
        }).pipe(
          Stream.runCollect,
          Effect.provide(
            fakeCustomerDataLayer({
              workspace: h.workspace,
              device: makeFakeDevice(),
            })
          )
        )
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(
      Exit.findErrorOption(exit).pipe(Option.map((error) => error._tag))
    ).toEqual(Option.some("CustomerReservationNotFound"));
  });

  test("manual refresh waits for automatic reads to stop, then reads once without restarting them", async () => {
    const h = harness();

    await h.run((manual) =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        const scheduled = h.last();
        expect(scheduled && canRefreshManually(scheduled)).toBe(false);

        yield* TestClock.adjust("10 seconds");
        yield* h.readsSettled(2);
        yield* TestClock.adjust("20 seconds");
        yield* h.readsSettled(3);
        yield* TestClock.adjust("40 seconds");
        yield* h.readsSettled(4);
        const exhausted = h.last();
        expect(exhausted && canRefreshManually(exhausted)).toBe(true);

        const before = h.states.length;
        yield* Queue.offer(manual, undefined);
        yield* h.readsSettled(5);
        const during = h.states.slice(before, -1);
        expect(during.length).toBeGreaterThan(0);
        expect(during.every((state) => state.reading)).toBe(true);
        expect(during.some(canRefreshManually)).toBe(false);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.reads()).toBe(5);
    expect(stopped(h.last())).toBe("exhausted");
  });

  test("a manual refresh after a 429 reads again and reports its own outcome", async () => {
    const h = harness();

    await h.run((manual) =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        h.workspace.fail("getReservationStatus", "rate-limited");
        yield* TestClock.adjust("10 seconds");
        yield* h.readsSettled(2);
        yield* Queue.offer(manual, undefined);
        yield* h.readsSettled(3);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.reads()).toBe(3);
    expect(h.last()?.failure).toEqual(Option.none());
    expect(stopped(h.last())).toBe("limited");
  });
});
