import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";
import {
  AccountExitFence,
  AccountScopedStorage,
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

/** One device and fence shared by the accounts' storage and the exit cleanup. */
const deviceWithFence = () => {
  const device = makeFakeDevice();
  const fence = Layer.succeed(AccountExitFence, makeAccountExitFence());
  const capabilities = fakeDeviceCapabilities(device);
  const exit = (accountId: string) =>
    Effect.runPromise(
      customerDataExitCleanup({ scope: "account", accountId }).pipe(
        Effect.provide(Layer.merge(capabilities, fence))
      )
    );
  return { device, fence, capabilities, exit };
};

type Setup = ReturnType<typeof deviceWithFence>;

const storageLayer = (
  { fence }: Setup,
  capabilities: Layer.Layer<DeviceCapabilities>,
  accountId: string
) =>
  accountDeviceLayer(capabilities, fence).pipe(
    Layer.provide(Layer.succeed(CustomerAccountScope, { accountId, apiOrigin }))
  );

/** The account's storage, built as its runtime would build it now. */
const openStorage = (setup: Setup, accountId: string) =>
  Effect.runPromise(
    Effect.service(AccountScopedStorage).pipe(
      Effect.provide(storageLayer(setup, setup.capabilities, accountId))
    )
  );

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("AccountScopedStorage", () => {
  test("keys the account's entries by origin and account", async () => {
    const setup = deviceWithFence();
    const storage = await openStorage(setup, "a");

    await run(storage.setItem(cache, "{}"));

    expect([...setup.device.storage.keys()]).toEqual([cacheKeyOf("a")]);
    expect(await run(storage.getItem(cache))).toEqual(Option.some("{}"));
  });

  test("refuses a name the exit cleanup wouldn't remove", async () => {
    const setup = deviceWithFence();
    const storage = await openStorage(setup, "a");

    const exit = await Effect.runPromiseExit(
      storage.setItem("deskohub.profile-draft", "{}")
    );

    expect(exit._tag).toBe("Failure");
    expect(setup.device.storage.size).toBe(0);
  });

  test("undoes a write that lands after its account exited", async () => {
    const setup = deviceWithFence();
    const landed = await run(Deferred.make<void>());
    const device: FakeDevice = setup.device;
    // A device write that only completes once `landed` resolves.
    const slowStorage = Layer.succeed(DeviceStorage, {
      getItem: () => Effect.succeed(Option.none()),
      setItem: (key, value) =>
        Effect.andThen(
          Deferred.await(landed),
          Effect.sync(() => {
            device.storage.set(key, value);
          })
        ),
      removeItems: (keys) =>
        Effect.sync(() => {
          for (const key of keys) device.storage.delete(key);
        }),
      keys: Effect.sync(() => [...device.storage.keys()]),
    });

    await run(
      Effect.gen(function* () {
        const storage = yield* AccountScopedStorage;
        const write = yield* Effect.forkChild(storage.setItem(cache, "{}"));
        yield* Effect.yieldNow;
        yield* Effect.promise(() => setup.exit("a"));
        yield* Deferred.succeed(landed, undefined);
        yield* Fiber.join(write);
      }).pipe(
        Effect.provide(
          storageLayer(setup, Layer.merge(setup.capabilities, slowStorage), "a")
        )
      )
    );

    expect(device.storage.has(cacheKeyOf("a"))).toBe(false);
  });

  test("another account signing in while the first exits keeps its storage", async () => {
    const setup = deviceWithFence();
    const first = await openStorage(setup, "a");
    await run(first.setItem(cache, "a-data"));

    // Account B's registry is built before A's exit cleanup runs.
    const second = await openStorage(setup, "b");
    await setup.exit("a");
    await run(second.setItem(cache, "b-data"));

    expect(setup.device.storage.has(cacheKeyOf("a"))).toBe(false);
    expect(await run(second.getItem(cache))).toEqual(Option.some("b-data"));
    expect(
      Option.isSome(
        await run(second.writeTemporaryFile("invoice.pdf", new Uint8Array([1])))
      )
    ).toBe(true);
  });

  test("an exited account writes nothing, and signing in again starts fresh", async () => {
    const setup = deviceWithFence();
    const beforeExit = await openStorage(setup, "a");

    await setup.exit("a");
    await run(beforeExit.setItem(cache, "stale"));

    expect(setup.device.storage.has(cacheKeyOf("a"))).toBe(false);
    expect(await run(beforeExit.getItem(cache))).toEqual(Option.none());
    expect(
      await run(beforeExit.writeTemporaryFile("invoice.pdf", new Uint8Array()))
    ).toEqual(Option.none());

    const again = await openStorage(setup, "a");
    await run(again.setItem(cache, "fresh"));

    expect(await run(again.getItem(cache))).toEqual(Option.some("fresh"));
  });

  test("a write from an exited session can't clobber the next session's write", async () => {
    const setup = deviceWithFence();
    const landed = await run(Deferred.make<void>());
    const inFlight = await run(Deferred.make<void>());
    const device: FakeDevice = setup.device;
    let slowWrites = 1;
    // The first device write only completes once `landed` resolves.
    const slowOnce = Layer.succeed(DeviceStorage, {
      getItem: (key) =>
        Effect.sync(() => Option.fromNullishOr(device.storage.get(key))),
      setItem: (key, value) => {
        const write = Effect.sync(() => {
          device.storage.set(key, value);
        });
        if (slowWrites === 0) return write;
        slowWrites -= 1;
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
    const capabilities = Layer.merge(setup.capabilities, slowOnce);
    const open = () =>
      run(
        Effect.service(AccountScopedStorage).pipe(
          Effect.provide(storageLayer(setup, capabilities, "a"))
        )
      );

    const exited = await open();
    const staleWrite = Effect.runFork(exited.setItem(cache, "stale"));
    await run(Deferred.await(inFlight));
    await setup.exit("a");
    const fresh = await open();
    const freshWrite = Effect.runFork(fresh.setItem(cache, "fresh"));
    await run(Deferred.succeed(landed, undefined));
    await run(Fiber.join(staleWrite));
    await run(Fiber.join(freshWrite));

    expect(await run(fresh.getItem(cache))).toEqual(Option.some("fresh"));
  });
});
