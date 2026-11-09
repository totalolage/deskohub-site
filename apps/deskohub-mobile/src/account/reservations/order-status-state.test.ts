import { describe, expect, test } from "bun:test";
import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Duration, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { makeCustomerDataRegistry } from "../../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { sampleOrderIds } from "../../customer-api/testing/sample-fixtures";
import { eventually, quietly } from "../../testing/eventually";
import {
  focusGained,
  focusLost,
  makeOrderStatusAtoms,
} from "./order-status-state";
import { reservationHistoryAtom } from "./reservations-list-state";
import { canRefreshManually, type StatusRefreshState } from "./status-refresh";
import type { StatusVisit } from "./status-refresh-rules";

const harness = (
  visit: StatusVisit = "normal",
  orderId: CustomerReservationOrderId = sampleOrderIds.pending
) => {
  const workspace = FakeWorkspace.forKind("linked");
  const registry = makeCustomerDataRegistry(
    Layer.mergeAll(
      fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
      TestClock.layer()
    )
  );
  const foreground = Atom.make(true);
  const atoms = makeOrderStatusAtoms(foreground);
  const status = atoms.status(orderId);
  // Each state the screen saw, with the number of reads sent by then.
  const seen: Array<{
    readonly state: StatusRefreshState;
    readonly reads: number;
  }> = [];
  const reads = () =>
    workspace.calls.filter((call) => call === "getReservationStatus").length;
  // Keeps the runtime (and its test clock) alive like a mounted screen does.
  const unmountRuntime = registry.mount(customerDataRuntime);
  const unmount = registry.subscribe(
    status,
    (result) =>
      Option.map(AsyncResult.value(result), (state) => {
        if (seen.at(-1)?.state !== state) seen.push({ state, reads: reads() });
      }),
    { immediate: true }
  );
  /**
   * Settles once `count` reads were sent and the screen shows the outcome of
   * the last one, then lets the refreshes reach their next wait.
   */
  const readsSettled = (count: number) =>
    eventually(
      () => {
        const last = seen.at(-1);
        return (
          reads() === count &&
          last !== undefined &&
          last.reads === count &&
          !last.state.reading
        );
      },
      () =>
        JSON.stringify({
          expected: count,
          reads: reads(),
          seen: seen.map(({ state, reads }) => [
            reads,
            state.reading,
            state.attempt,
            state.automatic._tag,
          ]),
        })
    ).pipe(Effect.andThen(quietly));
  const adjust = (duration: Duration.Input) =>
    Effect.runPromise(
      Effect.flatMap(
        AtomRegistry.getResult(customerDataRuntime)(registry),
        (context) => TestClock.adjust(duration).pipe(Effect.provide(context))
      )
    );
  const settle = (effect: Effect.Effect<void>) => Effect.runPromise(effect);
  return {
    workspace,
    registry,
    atoms,
    status,
    foreground,
    reads,
    settle,
    readsSettled: (count: number) => settle(readsSettled(count)),
    quietly: () => settle(quietly),
    adjust,
    orderId,
    focus: (focused: boolean) =>
      registry.update(
        atoms.focus(orderId),
        focused ? focusGained(visit) : focusLost
      ),
    tap: () => registry.update(atoms.refreshRequests(orderId), (n) => n + 1),
    dispose: () => {
      unmount();
      unmountRuntime();
    },
  };
};

describe("order status atoms", () => {
  test("read nothing until the screen is focused", async () => {
    const h = harness();

    await h.quietly();
    expect(h.reads()).toBe(0);

    h.focus(true);
    await h.readsSettled(1);
    h.dispose();
  });

  test("blur cancels the pending refresh and keeps the order on screen", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);

    h.focus(false);
    await h.adjust("30 minutes");
    await h.quietly();

    expect(h.reads()).toBe(1);
    expect(Option.isSome(AsyncResult.value(h.registry.get(h.status)))).toBe(
      true
    );
    h.dispose();
  });

  test("the background interrupts refreshes; the foreground continues the same count", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);
    await h.adjust("10 seconds");
    await h.readsSettled(2);

    h.registry.set(h.foreground, false);
    await h.adjust("30 minutes");
    await h.quietly();
    expect(h.reads()).toBe(2);

    h.registry.set(h.foreground, true);
    await h.quietly();
    expect(h.reads()).toBe(2);
    await h.adjust("20 seconds");
    await h.readsSettled(3);
    await h.adjust("40 seconds");
    await h.readsSettled(4);
    await h.adjust("30 minutes");
    await h.quietly();

    expect(h.reads()).toBe(4);
    h.dispose();
  });

  test("a stop after 429 holds across the background for the same visit", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);
    h.workspace.fail("getReservationStatus", "rate-limited");
    await h.adjust("10 seconds");
    await h.readsSettled(2);

    h.registry.set(h.foreground, false);
    h.registry.set(h.foreground, true);
    await h.adjust("30 minutes");
    await h.quietly();

    expect(h.reads()).toBe(2);
    h.dispose();
  });

  test("shows the screen as waiting only while a read is under way", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);

    const shown = h.registry.get(h.status);
    expect(AsyncResult.isSuccess(shown) && shown.waiting).toBe(false);
    h.dispose();
  });

  test("a new focus reads at once and restarts the automatic count", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);
    await h.adjust("10 seconds");
    await h.readsSettled(2);
    await h.adjust("20 seconds");
    await h.readsSettled(3);
    await h.adjust("40 seconds");
    await h.readsSettled(4);

    h.focus(false);
    h.focus(true);
    await h.readsSettled(5);
    await h.adjust("10 seconds");
    await h.readsSettled(6);
    h.dispose();
  });

  test("the refresh counter asks for a manual read once automatic reads stop", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);
    for (const [seconds, reads] of [
      [10, 2],
      [20, 3],
      [40, 4],
    ] as const) {
      await h.adjust(Duration.seconds(seconds));
      await h.readsSettled(reads);
    }

    h.tap();
    await h.readsSettled(5);
    await h.adjust("30 minutes");
    await h.quietly();

    expect(h.reads()).toBe(5);
    h.dispose();
  });

  test("a visit after payment reads on the payment-return schedule", async () => {
    const h = harness("after-payment");
    h.focus(true);
    await h.readsSettled(1);

    await h.adjust("3 seconds");
    await h.readsSettled(2);
    h.dispose();
  });

  test("quick taps read one after the other; a later tap reads again", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);
    for (const [seconds, reads] of [
      [10, 2],
      [20, 3],
      [40, 4],
    ] as const) {
      await h.adjust(Duration.seconds(seconds));
      await h.readsSettled(reads);
    }

    // The registry may hand both taps over at once; either way the reads
    // run one after the other.
    h.tap();
    h.tap();
    await h.quietly();
    const afterTaps = h.reads();
    expect([5, 6]).toContain(afterTaps);
    await h.readsSettled(afterTaps);

    h.tap();
    await h.readsSettled(afterTaps + 1);
    h.dispose();
  });

  test("a read cut off by the background still counts toward the visit's three", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);
    h.workspace.fail("getReservationStatus", "hang");
    await h.adjust("10 seconds");
    await Effect.runPromise(eventually(() => h.reads() === 2));

    h.registry.set(h.foreground, false);
    h.registry.set(h.foreground, true);
    await h.quietly();
    await h.adjust("20 seconds");
    await h.readsSettled(3);
    await h.adjust("40 seconds");
    await h.readsSettled(4);
    await h.adjust("30 minutes");
    await h.quietly();

    expect(h.reads()).toBe(4);
    h.dispose();
  });

  test("a new visit's first read shows as waiting over the previous order", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);
    h.focus(false);
    h.workspace.fail("getReservationStatus", "hang");

    h.focus(true);
    await Effect.runPromise(eventually(() => h.reads() === 2));
    const shown = h.registry.get(h.status);

    expect(AsyncResult.isSuccess(shown) && shown.waiting).toBe(true);
    // Refresh and pull-to-refresh stay disabled while it is under way.
    expect(Option.map(AsyncResult.value(shown), canRefreshManually)).toEqual(
      Option.some(false)
    );
    h.dispose();
  });

  test("a new visit whose first read fails keeps the order and retries the visit", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);
    h.focus(false);
    h.workspace.fail("getReservationStatus", "service-unavailable");

    h.focus(true);
    await Effect.runPromise(
      eventually(() => AsyncResult.isFailure(h.registry.get(h.status)))
    );
    const failed = h.registry.get(h.status);
    expect(Option.map(AsyncResult.value(failed), canRefreshManually)).toEqual(
      Option.some(true)
    );

    h.workspace.fail("getReservationStatus", "hang");
    h.registry.refresh(h.atoms.progress(h.orderId));
    await Effect.runPromise(eventually(() => h.reads() === 3));
    expect(
      Option.map(
        AsyncResult.value(h.registry.get(h.status)),
        canRefreshManually
      )
    ).toEqual(Option.some(false));

    h.registry.refresh(h.atoms.progress(h.orderId));
    await h.readsSettled(4);
    expect(AsyncResult.isSuccess(h.registry.get(h.status))).toBe(true);
    h.dispose();
  });

  test("refocusing a settled order keeps Refresh disabled until its first read answers", async () => {
    const h = harness("normal", sampleOrderIds.fulfilled);
    h.focus(true);
    await h.readsSettled(1);
    const settled = h.registry.get(h.status);
    expect(Option.map(AsyncResult.value(settled), canRefreshManually)).toEqual(
      Option.some(true)
    );

    h.focus(false);
    h.workspace.fail("getReservationStatus", "hang");
    h.focus(true);
    await Effect.runPromise(eventually(() => h.reads() === 2));
    const refocused = h.registry.get(h.status);

    expect(refocused.waiting).toBe(true);
    expect(
      Option.map(AsyncResult.value(refocused), canRefreshManually)
    ).toEqual(Option.some(false));
    h.dispose();
  });

  test("an order that settles after payment reads the reservations list again", async () => {
    const h = harness("after-payment");
    const listReads = () =>
      h.workspace.calls.filter((call) => call === "listReservations").length;
    const unmountList = h.registry.mount(reservationHistoryAtom);
    await h.settle(
      eventually(() =>
        AsyncResult.isSuccess(h.registry.get(reservationHistoryAtom))
      )
    );
    expect(listReads()).toBe(1);

    h.focus(true);
    await h.readsSettled(1);
    await h.adjust("3 seconds");
    await h.readsSettled(2);
    expect(listReads()).toBe(1);

    h.workspace.setOrderStatus(h.orderId, "fulfilled");
    await h.adjust("3 seconds");
    await h.readsSettled(3);
    await h.settle(eventually(() => listReads() === 2));
    await h.adjust("30 minutes");
    await h.quietly();

    expect(listReads()).toBe(2);
    unmountList();
    h.dispose();
  });

  test("refocusing a settled order after payment doesn't read the list again", async () => {
    const h = harness("after-payment", sampleOrderIds.fulfilled);
    const listReads = () =>
      h.workspace.calls.filter((call) => call === "listReservations").length;
    const unmountList = h.registry.mount(reservationHistoryAtom);
    await h.settle(
      eventually(() =>
        AsyncResult.isSuccess(h.registry.get(reservationHistoryAtom))
      )
    );

    h.focus(true);
    await h.readsSettled(1);
    await h.settle(eventually(() => listReads() === 2));
    h.focus(false);
    h.focus(true);
    await h.readsSettled(2);
    await h.quietly();

    expect(listReads()).toBe(2);
    unmountList();
    h.dispose();
  });
});
