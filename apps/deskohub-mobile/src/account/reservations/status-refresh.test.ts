import { describe, expect, test } from "bun:test";
import type {
  CustomerOrderStatus,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Effect, Exit, Fiber, Layer, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  AccountReadBudget,
  accountReadAllowance,
  automaticRefreshReserve,
} from "../../customer-api/account-read-budget";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { sampleOrderIds } from "../../customer-api/testing/sample-fixtures";
import { eventually, quietly } from "../../testing/eventually";
import { readOrderStatus, remainingReadBudget } from "./order-status-state";
import {
  canRefreshManually,
  type StatusRefreshState,
  statusRefreshes,
} from "./status-refresh";
import { AutomaticRefresh, type StatusVisit } from "./status-refresh-rules";

const statusReads = (workspace: FakeWorkspace) =>
  workspace.calls.filter((call) => call === "getReservationStatus").length;

const harness = ({
  visit = "normal",
  orderId = sampleOrderIds.pending,
  resume = Option.none(),
  previousStatus = Option.none(),
}: {
  readonly visit?: StatusVisit;
  readonly orderId?: CustomerReservationOrderId;
  readonly resume?: Option.Option<StatusRefreshState>;
  readonly previousStatus?: Option.Option<CustomerOrderStatus>;
} = {}) => {
  const workspace = FakeWorkspace.forKind("linked");
  const layer = Layer.mergeAll(
    fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
    TestClock.layer()
  );
  const states: Array<StatusRefreshState> = [];
  const last = () => states.at(-1);
  let settledRuns = 0;
  const settled = () => settledRuns;
  const reads = () => statusReads(workspace);
  /**
   * Settles once `count` reads were made and the stream reported each: every
   * read after the first is announced with a `reading` state.
   */
  const readsSettled = (count: number) =>
    eventually(
      () =>
        reads() === count &&
        states.filter((state) => state.reading).length ===
          count - (Option.isNone(resume) ? 1 : 0) &&
        last()?.reading === false
    );
  const run = <A, E>(
    script: (
      manual: Queue.Queue<void>
    ) => Effect.Effect<A, E, AccountReadBudget>
  ) =>
    Effect.gen(function* () {
      const manual = yield* Queue.unbounded<void>();
      const fiber = yield* statusRefreshes({
        read: readOrderStatus(orderId),
        remainingBudget: remainingReadBudget,
        visit,
        manualRequests: Stream.fromQueue(manual),
        resume,
        previousStatus,
        onSettled: Effect.sync(() => {
          settledRuns += 1;
        }),
      }).pipe(
        Stream.runForEach((state) => Effect.sync(() => states.push(state))),
        Effect.forkChild
      );
      const outcome = yield* script(manual);
      yield* Fiber.interrupt(fiber);
      return outcome;
    }).pipe(Effect.provide(layer), Effect.runPromise);
  return {
    workspace,
    states,
    last,
    reads,
    readsSettled,
    run,
    orderId,
    settled,
  };
};

const stopped = (state: StatusRefreshState | undefined) =>
  state !== undefined && AutomaticRefresh.$is("Stopped")(state.automatic)
    ? state.automatic.reason
    : undefined;

/** Spends every read but the automatic-refresh reserve, as other screens would. */
const spendAllButReserve = (budget: AccountReadBudget["Service"]) =>
  Effect.repeat(budget.spend, {
    times: accountReadAllowance.reads - automaticRefreshReserve - 1,
  });

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
        h.workspace.setOrderStatus(h.orderId, "fulfilled");
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
        const budget = yield* AccountReadBudget;
        // Reads elsewhere leave the reserve; the screen's first read
        // leaves one fewer.
        yield* spendAllButReserve(budget);
        yield* h.readsSettled(1);
        yield* TestClock.adjust("1 minute");
        yield* quietly;
        expect(yield* budget.remaining).toBe(automaticRefreshReserve - 1);
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
          resume: Option.none(),
          previousStatus: Option.none(),
          onSettled: Effect.void,
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

  test("rechecks the budget after waiting and skips the read when it ran low", async () => {
    const h = harness();

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        const budget = yield* AccountReadBudget;
        // Other screens spend all but the reserve while the screen waits:
        // with the screen's first read, one fewer is left.
        yield* spendAllButReserve(budget);
        yield* TestClock.adjust("10 seconds");
        yield* eventually(() => stopped(h.last()) === "budget");
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.reads()).toBe(1);
  });

  test("a resumed run continues its automatic count without a first read", async () => {
    const first = harness();
    await first.run(() =>
      Effect.gen(function* () {
        yield* first.readsSettled(1);
        yield* TestClock.adjust("10 seconds");
        yield* first.readsSettled(2);
      })
    );
    const left = first.last();
    expect(left?.attempt).toBe(1);

    const h = harness({ resume: Option.fromUndefinedOr(left) });
    await h.run(() =>
      Effect.gen(function* () {
        yield* quietly;
        expect(h.reads()).toBe(0);
        yield* TestClock.adjust("19 seconds");
        yield* quietly;
        expect(h.reads()).toBe(0);
        yield* TestClock.adjust("1 second");
        yield* h.readsSettled(1);
        yield* TestClock.adjust("40 seconds");
        yield* h.readsSettled(2);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.reads()).toBe(2);
    expect(stopped(h.last())).toBe("exhausted");
  });

  test("a resumed run that had stopped stays stopped but answers taps", async () => {
    const first = harness();
    await first.run(() =>
      Effect.gen(function* () {
        yield* first.readsSettled(1);
        first.workspace.fail("getReservationStatus", "rate-limited");
        yield* TestClock.adjust("10 seconds");
        yield* first.readsSettled(2);
      })
    );

    const h = harness({ resume: Option.fromUndefinedOr(first.last()) });
    await h.run((manual) =>
      Effect.gen(function* () {
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
        expect(h.reads()).toBe(0);
        expect(stopped(h.last())).toBe("limited");
        yield* Queue.offer(manual, undefined);
        yield* eventually(() => h.reads() === 1 && h.last()?.reading === false);
      })
    );
  });
});

describe("statusRefreshes when the order settles", () => {
  test("an automatic read that settles the order runs onSettled once", async () => {
    const h = harness({ visit: "after-payment" });

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        yield* TestClock.adjust("3 seconds");
        yield* h.readsSettled(2);
        expect(h.settled()).toBe(0);
        h.workspace.setOrderStatus(h.orderId, "fulfilled");
        yield* TestClock.adjust("3 seconds");
        yield* h.readsSettled(3);
        expect(h.settled()).toBe(1);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.settled()).toBe(1);
  });

  test("a normal visit runs onSettled when a read settles the order", async () => {
    const h = harness();

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        h.workspace.setOrderStatus(h.orderId, "fulfilled");
        yield* TestClock.adjust("10 seconds");
        yield* h.readsSettled(2);
      })
    );

    expect(h.settled()).toBe(1);
  });

  test("an order that ends without a booking counts as settled too", async () => {
    const h = harness({ visit: "after-payment" });

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        h.workspace.setOrderStatus(h.orderId, "payment_failed");
        yield* TestClock.adjust("3 seconds");
        yield* h.readsSettled(2);
      })
    );

    expect(h.settled()).toBe(1);
  });

  test("a read that finds the order still settling doesn't run onSettled", async () => {
    const h = harness({ visit: "after-payment" });

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        h.workspace.setOrderStatus(h.orderId, "paid_waiting_fulfillment");
        yield* TestClock.adjust("3 seconds");
        yield* h.readsSettled(2);
      })
    );

    expect(h.settled()).toBe(0);
  });

  test("after payment, a first read that finds the order settled runs onSettled", async () => {
    const h = harness({
      visit: "after-payment",
      orderId: sampleOrderIds.fulfilled,
    });

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        yield* TestClock.adjust("30 minutes");
        yield* quietly;
      })
    );

    expect(h.settled()).toBe(1);
  });

  test("a first read compares with the status an earlier session showed", async () => {
    const shown = (previousStatus: CustomerOrderStatus) =>
      harness({
        visit: "after-payment",
        orderId: sampleOrderIds.fulfilled,
        previousStatus: Option.some(previousStatus),
      });
    const unchanged = shown("fulfilled");
    const settling = shown("pending");

    await unchanged.run(() => unchanged.readsSettled(1));
    await settling.run(() => settling.readsSettled(1));

    expect(unchanged.settled()).toBe(0);
    expect(settling.settled()).toBe(1);
  });

  test("a manual read that finds a delayed order confirmed runs onSettled", async () => {
    const h = harness();
    h.workspace.setOrderStatus(h.orderId, "paid_fulfillment_delayed");

    await h.run((manual) =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        expect(stopped(h.last())).toBe("settled");
        h.workspace.setOrderStatus(h.orderId, "fulfilled");
        yield* Queue.offer(manual, undefined);
        yield* h.readsSettled(2);
      })
    );

    expect(h.settled()).toBe(1);
  });

  test("a normal visit to a settled order doesn't run onSettled", async () => {
    const h = harness({ orderId: sampleOrderIds.fulfilled });

    await h.run((manual) =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        yield* Queue.offer(manual, undefined);
        yield* h.readsSettled(2);
      })
    );

    expect(h.settled()).toBe(0);
  });

  test("a manual read that settles the order runs onSettled", async () => {
    const h = harness();

    await h.run((manual) =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        yield* TestClock.adjust("10 seconds");
        yield* h.readsSettled(2);
        yield* TestClock.adjust("20 seconds");
        yield* h.readsSettled(3);
        yield* TestClock.adjust("40 seconds");
        yield* h.readsSettled(4);
        expect(stopped(h.last())).toBe("exhausted");
        h.workspace.setOrderStatus(h.orderId, "fulfilled");
        yield* Queue.offer(manual, undefined);
        yield* h.readsSettled(5);
      })
    );

    expect(h.settled()).toBe(1);
  });

  test("a failed read doesn't run onSettled", async () => {
    const h = harness({ visit: "after-payment" });

    await h.run(() =>
      Effect.gen(function* () {
        yield* h.readsSettled(1);
        h.workspace.fail("getReservationStatus", "service-unavailable");
        yield* TestClock.adjust("3 seconds");
        yield* h.readsSettled(2);
      })
    );

    expect(h.settled()).toBe(0);
  });

  test("a resumed run of an order that had settled doesn't run onSettled again", async () => {
    const first = harness({
      visit: "after-payment",
      orderId: sampleOrderIds.fulfilled,
    });
    await first.run(() => first.readsSettled(1));
    expect(first.settled()).toBe(1);

    const h = harness({
      visit: "after-payment",
      orderId: sampleOrderIds.fulfilled,
      resume: Option.fromUndefinedOr(first.last()),
    });
    await h.run((manual) =>
      Effect.gen(function* () {
        yield* Queue.offer(manual, undefined);
        yield* eventually(() => h.reads() === 1 && h.last()?.reading === false);
      })
    );

    expect(h.settled()).toBe(0);
  });
});
