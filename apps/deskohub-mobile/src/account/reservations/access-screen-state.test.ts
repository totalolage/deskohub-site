import { describe, expect, test } from "bun:test";
import {
  type CustomerReservationAccess,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { type Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  AsyncResult,
  type Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import {
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import {
  Clipboard,
  DeviceCapabilityFailed,
} from "../../customer-api/device-capabilities";
import {
  makeCustomerDataRegistry,
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { sampleOrderIds } from "../../customer-api/testing/sample-fixtures";
import {
  accessCountdownAtom,
  accessErrorMessage,
  copyAccessCodeAtom,
  reservationAccessAtom,
} from "./access-screen-state";

const orderId = CustomerReservationOrderId.make("test-order-access");
const pin = "482915";

/** Gives the fake Workspace's fulfilled order `orderId` with `access`. */
const withAccess = (
  workspace: FakeWorkspace,
  access: CustomerReservationAccess | undefined
) => {
  const fulfilled = workspace.data.orders.get(sampleOrderIds.fulfilled);
  if (fulfilled === undefined)
    throw new Error("fixture has no fulfilled order");
  workspace.data = {
    ...workspace.data,
    orders: new Map([
      ...workspace.data.orders,
      [orderId, { state: { ...fulfilled.state, orderId }, access }],
    ]),
  };
};

const atMillis = (millis: number) => new Date(millis).toISOString();

/** A fake account whose data runtime runs on the test clock (epoch start). */
const onTestClock = (extra: Layer.Layer<never> = Layer.empty) => {
  const workspace = FakeWorkspace.forKind("linked");
  const device = makeFakeDevice();
  const registry = makeCustomerDataRegistry(
    Layer.mergeAll(
      fakeCustomerDataLayer({ workspace, device }),
      TestClock.layer(),
      extra
    )
  );
  return { registry, workspace, device };
};

const advanceClock = customerDataRuntime.fn((duration: Duration.Input) =>
  TestClock.adjust(duration)
);

const advance = (
  registry: AtomRegistry.AtomRegistry,
  duration: Duration.Input
) => {
  registry.set(advanceClock, duration);
  return Effect.runPromise(
    AtomRegistry.getResult(advanceClock, { suspendOnWaiting: true })(registry)
  );
};

const runCopy = (registry: AtomRegistry.AtomRegistry) => {
  const copy = copyAccessCodeAtom(orderId);
  registry.set(copy, undefined);
  return Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(copy, { suspendOnWaiting: true })(registry)
    )
  );
};

const countdownTag = (
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<{ readonly _tag: string }, unknown>>
) => {
  const result = registry.get(atom);
  return AsyncResult.isSuccess(result) ? result.value._tag : result._tag;
};

const holdsPin = (values: Iterable<string>) =>
  [...values].some((value) => value.includes(pin));

describe("reservationAccessAtom", () => {
  test("reads the order's PIN and window through the real client", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    withAccess(workspace, {
      code: pin,
      accessStartsAt: atMillis(0),
      accessEndsAt: atMillis(60_000),
    });

    const result = await settle(registry, reservationAccessAtom(orderId));

    expect(result).toMatchObject({ _tag: "Success", success: { code: pin } });
    expect(workspace.calls).toEqual(["getReservationAccess"]);
  });

  test("a missing order is the NotFound view error", async () => {
    const { registry } = makeFakeCustomerData("linked");

    const result = await settle(
      registry,
      reservationAccessAtom(CustomerReservationOrderId.make("no-such-order"))
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(toCustomerViewError(result.failure)).toEqual(
        CustomerViewError.NotFound()
      );
    }
  });

  test("an order without a PIN is the AccessCodeUnavailable view error", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    withAccess(workspace, undefined);

    const result = await settle(registry, reservationAccessAtom(orderId));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(toCustomerViewError(result.failure)).toEqual(
        CustomerViewError.AccessCodeUnavailable()
      );
    }
  });
});

describe("accessErrorMessage", () => {
  test("explains a missing order and an unavailable PIN itself", () => {
    for (const error of [
      CustomerViewError.NotFound(),
      CustomerViewError.AccessCodeUnavailable(),
    ]) {
      for (const locale of ["en-US", "cs-CZ"] as const) {
        expect(accessErrorMessage(error, locale)).toEqual(expect.any(String));
      }
    }
  });

  test("leaves every other failure to the shared copy", () => {
    for (const error of [
      CustomerViewError.RateLimited(),
      CustomerViewError.Unavailable(),
      CustomerViewError.InvoiceNotIssued(),
      CustomerViewError.Unexpected(),
    ]) {
      expect(accessErrorMessage(error, "en-US")).toBeUndefined();
    }
  });
});

describe("copyAccessCodeAtom", () => {
  test("copies the PIN as sensitive and stores it nowhere", async () => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    withAccess(workspace, {
      code: pin,
      accessStartsAt: atMillis(0),
      accessEndsAt: atMillis(60_000),
    });
    const unmount = registry.mount(reservationAccessAtom(orderId));
    await settle(registry, reservationAccessAtom(orderId));

    expect(holdsPin(device.storage.keys())).toBe(false);
    expect(holdsPin(device.storage.values())).toBe(false);

    const copied = await runCopy(registry);
    unmount();

    expect(copied._tag).toBe("Success");
    expect(device.copied).toEqual([{ text: pin, sensitive: true }]);
    expect(holdsPin(device.storage.keys())).toBe(false);
    expect(holdsPin(device.storage.values())).toBe(false);
    expect(device.files.size).toBe(0);
    // Copying reuses the loaded PIN rather than reading it again.
    expect(workspace.calls).toEqual(["getReservationAccess"]);
  });

  test("a clipboard that fails is a failed copy", async () => {
    const { registry, workspace, device } = onTestClock(
      Layer.succeed(Clipboard, {
        copy: () =>
          Effect.fail(new DeviceCapabilityFailed({ capability: "clipboard" })),
      })
    );
    withAccess(workspace, {
      code: pin,
      accessStartsAt: atMillis(0),
      accessEndsAt: atMillis(60_000),
    });
    const unmount = registry.mount(reservationAccessAtom(orderId));
    await settle(registry, reservationAccessAtom(orderId));

    const copied = await runCopy(registry);
    unmount();

    expect(copied).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "DeviceCapabilityFailed" },
    });
    expect(device.copied).toEqual([]);
  });
});

describe("accessCountdownAtom", () => {
  test("ticks across the start and the end, then stops", async () => {
    const { registry, workspace } = onTestClock();
    withAccess(workspace, {
      code: pin,
      accessStartsAt: atMillis(2_000),
      accessEndsAt: atMillis(4_000),
    });
    const countdown = accessCountdownAtom(orderId);
    const unmount = registry.mount(countdown);
    await settle(registry, reservationAccessAtom(orderId));
    const seen = [countdownTag(registry, countdown)];

    for (let second = 1; second <= 5; second += 1) {
      await advance(registry, "1 second");
      seen.push(countdownTag(registry, countdown));
    }
    const final = registry.get(countdown);
    unmount();

    expect(seen).toEqual([
      "Upcoming", // 0 s
      "Upcoming", // 1 s
      "Open", // 2 s, exactly the start
      "Open", // 3 s
      "Ended", // 4 s, exactly the end
      "Ended", // 5 s
    ]);
    // The stream has finished: nothing is waiting for another tick.
    expect(AsyncResult.isSuccess(final) && final.waiting).toBe(false);
  });

  test("reads the PIN once however long the clock ticks", async () => {
    const { registry, workspace } = onTestClock();
    withAccess(workspace, {
      code: pin,
      accessStartsAt: atMillis(0),
      accessEndsAt: atMillis(60_000),
    });
    const unmount = registry.mount(accessCountdownAtom(orderId));
    await settle(registry, reservationAccessAtom(orderId));

    await advance(registry, "10 seconds");
    unmount();

    expect(workspace.calls).toEqual(["getReservationAccess"]);
  });

  test("shows no countdown for a window it can't read", async () => {
    const { registry, workspace } = onTestClock();
    withAccess(workspace, {
      code: pin,
      accessStartsAt: "not a time",
      accessEndsAt: atMillis(60_000),
    });
    const countdown = accessCountdownAtom(orderId);
    const unmount = registry.mount(countdown);
    await settle(registry, reservationAccessAtom(orderId));
    await advance(registry, "1 second");
    const result = registry.get(countdown);
    unmount();

    expect(AsyncResult.isSuccess(result)).toBe(false);
  });
});
