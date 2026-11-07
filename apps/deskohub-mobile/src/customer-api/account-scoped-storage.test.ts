import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";
import {
  AccountExitFence,
  AccountScopedStorage,
  type AccountSession,
  accountDeviceLayer,
  accountStorageKey,
  makeAccountExitFence,
} from "./account-scoped-storage";
import { CustomerAccountScope } from "./customer-api.service";
import { type DeviceCapabilities, DeviceStorage } from "./device-capabilities";
import { customerDataExitCleanup } from "./exit-cleanup";
import {
  type FakeDevice,
  fakeDeviceCapabilities,
  makeFakeDevice,
} from "./testing/fake-customer-data";

const apiOrigin = "https://x.example";
const cache = "deskohub.reservations.v1";
const cacheKeyOf = (accountId: string) =>
  accountStorageKey(cache, { apiOrigin, accountId });
const sessionA1: AccountSession = { accountId: "a", sessionStartedAt: 1 };
const sessionA2: AccountSession = { accountId: "a", sessionStartedAt: 2 };
const sessionB: AccountSession = { accountId: "b", sessionStartedAt: 3 };

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/** One device and fence shared by the sessions' storage and the exit cleanup. */
const deviceWithFence = () => {
  const device = makeFakeDevice();
  const fence = Layer.succeed(AccountExitFence, makeAccountExitFence());
  const capabilities = fakeDeviceCapabilities(device);
  const exit = (session: AccountSession) =>
    customerDataExitCleanup({ scope: "account", ...session }).pipe(
      Effect.provide(Layer.merge(capabilities, fence))
    );
  return { device, fence, capabilities, exit };
};

type Setup = ReturnType<typeof deviceWithFence>;

/** The session's storage, opened as its runtime would open it now. */
const openStorage = (
  setup: Setup,
  session: AccountSession,
  capabilities: Layer.Layer<DeviceCapabilities> = setup.capabilities
) =>
  run(
    Effect.service(AccountScopedStorage).pipe(
      Effect.provide(
        accountDeviceLayer(capabilities, setup.fence).pipe(
          Layer.provide(
            Layer.succeed(CustomerAccountScope, { ...session, apiOrigin })
          )
        )
      )
    )
  );

/**
 * A device store whose first write waits for `landed`, announcing on
 * `inFlight` once it has started.
 */
const slowFirstWrite = async (device: FakeDevice) => {
  const inFlight = await run(Deferred.make<void>());
  const landed = await run(Deferred.make<void>());
  let slow = true;
  const layer = Layer.succeed(DeviceStorage, {
    getItem: (key) =>
      Effect.sync(() => Option.fromNullishOr(device.storage.get(key))),
    setItem: (key, value) => {
      const write = Effect.sync(() => {
        device.storage.set(key, value);
      });
      if (!slow) return write;
      slow = false;
      return Deferred.succeed(inFlight, undefined).pipe(
        Effect.andThen(Deferred.await(landed)),
        Effect.andThen(write)
      );
    },
    removeItems: (keys) =>
      Effect.sync(() => {
        for (const key of keys) device.storage.delete(key);
      }),
    keys: Effect.sync(() => [...device.storage.keys()]),
  });
  return { layer, inFlight, landed };
};

describe("AccountScopedStorage", () => {
  test("keys the session's entries by origin and account", async () => {
    const setup = deviceWithFence();
    const storage = await openStorage(setup, sessionA1);

    await run(storage.setItem(cache, "{}"));

    expect([...setup.device.storage.keys()]).toEqual([cacheKeyOf("a")]);
    expect(await run(storage.getItem(cache))).toEqual(Option.some("{}"));
  });

  test("refuses a name the exit cleanup wouldn't remove", async () => {
    const setup = deviceWithFence();
    const storage = await openStorage(setup, sessionA1);

    const exit = await Effect.runPromiseExit(
      storage.setItem("deskohub.profile-draft", "{}")
    );

    expect(exit._tag).toBe("Failure");
    expect(setup.device.storage.size).toBe(0);
  });

  test("an exit waits for a write in flight, then removes it", async () => {
    const setup = deviceWithFence();
    const slow = await slowFirstWrite(setup.device);
    const storage = await openStorage(
      setup,
      sessionA1,
      Layer.merge(setup.capabilities, slow.layer)
    );

    const write = Effect.runFork(storage.setItem(cache, "{}"));
    await run(Deferred.await(slow.inFlight));
    const exit = Effect.runFork(setup.exit(sessionA1));
    await run(Deferred.succeed(slow.landed, undefined));
    await run(Fiber.join(write));
    await run(Fiber.join(exit));

    expect(setup.device.storage.has(cacheKeyOf("a"))).toBe(false);
  });

  test("an exited session reads, writes and shares nothing", async () => {
    const setup = deviceWithFence();
    const storage = await openStorage(setup, sessionA1);
    await run(storage.setItem(cache, "kept until exit"));

    await run(setup.exit(sessionA1));
    await run(storage.setItem(cache, "stale"));

    expect(setup.device.storage.has(cacheKeyOf("a"))).toBe(false);
    expect(await run(storage.getItem(cache))).toEqual(Option.none());
    expect(
      await run(storage.writeTemporaryFile("invoice.pdf", new Uint8Array()))
    ).toEqual(Option.none());
    expect(setup.device.files.size).toBe(0);
  });

  test("a write from an exited session can't clobber the next sign-in's", async () => {
    const setup = deviceWithFence();
    const slow = await slowFirstWrite(setup.device);
    const capabilities = Layer.merge(setup.capabilities, slow.layer);
    const first = await openStorage(setup, sessionA1, capabilities);

    const staleWrite = Effect.runFork(first.setItem(cache, "stale"));
    await run(Deferred.await(slow.inFlight));
    const exit = Effect.runFork(setup.exit(sessionA1));
    const opening = openStorage(setup, sessionA2, capabilities);
    await run(Deferred.succeed(slow.landed, undefined));
    await run(Fiber.join(staleWrite));
    await run(Fiber.join(exit));
    const second = await opening;
    await run(second.setItem(cache, "fresh"));
    await run(first.setItem(cache, "stale again"));

    expect(await run(second.getItem(cache))).toEqual(Option.some("fresh"));
  });

  test("a removal from an exited session leaves the next sign-in's entry", async () => {
    const setup = deviceWithFence();
    const first = await openStorage(setup, sessionA1);
    await run(setup.exit(sessionA1));
    const second = await openStorage(setup, sessionA2);
    await run(second.setItem(cache, "fresh"));

    await run(first.removeItem(cache));

    expect(await run(second.getItem(cache))).toEqual(Option.some("fresh"));
  });

  test("another account signing in while the first exits keeps its storage", async () => {
    const setup = deviceWithFence();
    const first = await openStorage(setup, sessionA1);
    await run(first.setItem(cache, "a-data"));
    const second = await openStorage(setup, sessionB);

    await run(setup.exit(sessionA1));
    await run(second.setItem(cache, "b-data"));

    expect(setup.device.storage.has(cacheKeyOf("a"))).toBe(false);
    expect(await run(second.getItem(cache))).toEqual(Option.some("b-data"));
    expect(
      Option.isSome(
        await run(second.writeTemporaryFile("invoice.pdf", new Uint8Array([1])))
      )
    ).toBe(true);
  });
});
