import { describe, expect, test } from "bun:test";
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
import { makeOrderStatusAtoms } from "./order-status-state";
import type { StatusRefreshState } from "./status-refresh";
import type { StatusVisit } from "./status-refresh-rules";

const orderId = sampleOrderIds.pending;

const harness = (visit: StatusVisit = "normal") => {
  const workspace = FakeWorkspace.forKind("linked");
  const registry = makeCustomerDataRegistry(
    Layer.mergeAll(
      fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
      TestClock.layer()
    )
  );
  const foreground = Atom.make(true);
  const atoms = makeOrderStatusAtoms(foreground);
  const status = atoms.status(orderId)(visit);
  const states: Array<StatusRefreshState> = [];
  // Keeps the runtime (and its test clock) alive like a mounted screen does.
  const unmountRuntime = registry.mount(customerDataRuntime);
  const unmount = registry.subscribe(
    status,
    (result) =>
      Option.map(AsyncResult.value(result), (state) => {
        if (states.at(-1) !== state) states.push(state);
      }),
    { immediate: true }
  );
  const reads = () =>
    workspace.calls.filter((call) => call === "getReservationStatus").length;
  const readsSettled = (count: number) =>
    eventually(
      () =>
        reads() === count &&
        Option.match(AsyncResult.value(registry.get(status)), {
          onNone: () => false,
          onSome: (state) => !state.reading,
        })
    );
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
    states,
    reads,
    readsSettled: (count: number) => settle(readsSettled(count)),
    quietly: () => settle(quietly),
    adjust,
    focus: (focused: boolean) => registry.set(atoms.focused(orderId), focused),
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
    expect(
      Option.isSome(AsyncResult.value(h.registry.get(h.status)))
    ).toBe(true);
    h.dispose();
  });

  test("going to the background cancels the pending refresh", async () => {
    const h = harness();
    h.focus(true);
    await h.readsSettled(1);

    h.registry.set(h.foreground, false);
    await h.adjust("30 minutes");
    await h.quietly();

    expect(h.reads()).toBe(1);

    h.registry.set(h.foreground, true);
    await h.readsSettled(2);
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

    h.registry.update(h.atoms.refreshRequests(orderId), (count) => count + 1);
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
});
