import { describe, expect, test } from "bun:test";
import {
  type CustomerReservationAccess,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { type Duration, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import {
  type CustomerRequestFailure,
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
  accessWindowKey,
  copyAccessCodeAtom,
  reservationAccessAtom,
  shownAccess,
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

describe("shownAccess", () => {
  const refreshed = async (
    arrange: (workspace: FakeWorkspace) => void
  ): Promise<AsyncResult.AsyncResult<unknown, CustomerRequestFailure>> => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    withAccess(workspace, {
      code: pin,
      accessStartsAt: atMillis(0),
      accessEndsAt: atMillis(60_000),
    });
    const atom = reservationAccessAtom(orderId);
    const unmount = registry.mount(atom);
    await settle(registry, atom);
    arrange(workspace);
    registry.refresh(atom);
    await Effect.runPromise(
      Effect.result(
        AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
      )
    );
    const result = registry.get(atom);
    unmount();
    return result;
  };

  test("drops the last PIN when a refresh finds it withdrawn", async () => {
    const result = await refreshed((workspace) =>
      withAccess(workspace, undefined)
    );

    // The read itself keeps the last success, as every refresh does …
    expect(Option.isSome(AsyncResult.value(result))).toBe(true);
    // … but the screen shows none of it, only the failure.
    const shown = shownAccess(result);
    expect(Option.isNone(AsyncResult.value(shown))).toBe(true);
    expect(AsyncResult.isFailure(shown)).toBe(true);
  });

  test("drops the last PIN when a refresh finds the order gone", async () => {
    const result = await refreshed((workspace) => {
      workspace.data = {
        ...workspace.data,
        orders: new Map(
          [...workspace.data.orders].filter(([id]) => id !== orderId)
        ),
      };
    });

    expect(Option.isNone(AsyncResult.value(shownAccess(result)))).toBe(true);
  });

  test("keeps the last PIN through a refresh that fails for a while", async () => {
    const result = await refreshed((workspace) =>
      workspace.fail("getReservationAccess", "rate-limited")
    );

    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(AsyncResult.value(shownAccess(result))).toMatchObject(
      Option.some({ code: pin })
    );
  });
});

describe("copyAccessCodeAtom", () => {
  const runCopy = (registry: AtomRegistry.AtomRegistry) => {
    const copy = copyAccessCodeAtom(orderId);
    const unmount = registry.mount(copy);
    registry.set(copy, pin);
    return Effect.runPromise(
      Effect.result(
        AtomRegistry.getResult(copy, { suspendOnWaiting: true })(registry)
      )
    ).finally(unmount);
  };

  test("copies the PIN as sensitive and stores it nowhere", async () => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    withAccess(workspace, {
      code: pin,
      accessStartsAt: atMillis(0),
      accessEndsAt: atMillis(60_000),
    });
    await settle(registry, reservationAccessAtom(orderId));

    expect(holdsPin(device.storage.keys())).toBe(false);
    expect(holdsPin(device.storage.values())).toBe(false);

    const copied = await runCopy(registry);

    expect(copied._tag).toBe("Success");
    expect(device.copied).toEqual([{ text: pin, sensitive: true }]);
    expect(holdsPin(device.storage.keys())).toBe(false);
    expect(holdsPin(device.storage.values())).toBe(false);
    expect(device.files.size).toBe(0);
    // Copying spends no read: it copies the PIN on screen.
    expect(workspace.calls).toEqual(["getReservationAccess"]);
  });

  test("a clipboard that fails is a failed copy", async () => {
    const { registry, device } = onTestClock(
      Layer.succeed(Clipboard, {
        copy: () =>
          Effect.fail(new DeviceCapabilityFailed({ capability: "clipboard" })),
      })
    );

    const copied = await runCopy(registry);

    expect(copied).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "DeviceCapabilityFailed" },
    });
    expect(device.copied).toEqual([]);
  });
});

describe("accessCountdownAtom", () => {
  const countdownTag = (
    registry: AtomRegistry.AtomRegistry,
    atom: ReturnType<typeof accessCountdownAtom>
  ) =>
    Option.match(Option.flatten(AsyncResult.value(registry.get(atom))), {
      onNone: () => "none",
      onSome: (state) => state._tag,
    });

  test("ticks across the start and the end, then stops", async () => {
    const { registry } = onTestClock();
    const countdown = accessCountdownAtom(
      accessWindowKey({
        accessStartsAt: atMillis(2_000),
        accessEndsAt: atMillis(4_000),
      })
    );
    const unmount = registry.mount(countdown);
    await advance(registry, 0);
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

  test("runs on the window alone, without reading the API", async () => {
    const { registry, workspace } = onTestClock();
    const countdown = accessCountdownAtom(
      accessWindowKey({
        accessStartsAt: atMillis(0),
        accessEndsAt: atMillis(60_000),
      })
    );
    const unmount = registry.mount(countdown);

    await advance(registry, "10 seconds");
    const tag = countdownTag(registry, countdown);
    unmount();

    expect(tag).toBe("Open");
    expect(workspace.calls).toEqual([]);
  });

  test("says there is no countdown for a window it can't read", async () => {
    const { registry } = onTestClock();
    const countdown = accessCountdownAtom(
      accessWindowKey({
        accessStartsAt: "not a time",
        accessEndsAt: atMillis(60_000),
      })
    );
    const unmount = registry.mount(countdown);
    await advance(registry, "1 second");
    const result = registry.get(countdown);
    unmount();

    expect(result).toMatchObject({ _tag: "Success", waiting: false });
    expect(countdownTag(registry, countdown)).toBe("none");
  });

  test("is one atom per window, so a new window starts afresh", () => {
    const window = {
      accessStartsAt: atMillis(0),
      accessEndsAt: atMillis(60_000),
    };

    expect(accessCountdownAtom(accessWindowKey(window))).toBe(
      accessCountdownAtom(accessWindowKey({ ...window }))
    );
    expect(accessCountdownAtom(accessWindowKey(window))).not.toBe(
      accessCountdownAtom(
        accessWindowKey({ ...window, accessEndsAt: atMillis(120_000) })
      )
    );
  });
});
