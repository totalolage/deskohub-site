import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";
import {
  AccountExitFence,
  AccountScopedStorage,
  accountDeviceLayer,
  makeAccountExitFence,
} from "./account-scoped-storage";
import { DeviceStorage } from "./device-capabilities";
import { customerDataExitCleanup } from "./exit-cleanup";
import {
  fakeDeviceCapabilities,
  makeFakeDevice,
} from "./testing/fake-customer-data";

const cacheKey = "deskohub.reservations.v1.https://x.example.sample-account-1";

/** One device and fence shared by an account's storage and the exit cleanup. */
const deviceWithFence = () => {
  const device = makeFakeDevice();
  const fence = Layer.succeed(AccountExitFence, makeAccountExitFence());
  const capabilities = fakeDeviceCapabilities(device);
  const exit = customerDataExitCleanup.pipe(
    Effect.provide(Layer.merge(capabilities, fence))
  );
  return { device, fence, capabilities, exit };
};

const withAccountStorage = <A, E>(
  { capabilities, fence }: ReturnType<typeof deviceWithFence>,
  use: (storage: AccountScopedStorage["Service"]) => Effect.Effect<A, E>
) =>
  Effect.flatMap(Effect.service(AccountScopedStorage), use).pipe(
    Effect.provide(accountDeviceLayer(capabilities, fence))
  );

describe("AccountScopedStorage", () => {
  test("keeps the account's data until it exits", async () => {
    const setup = deviceWithFence();

    const read = await Effect.runPromise(
      withAccountStorage(setup, (storage) =>
        Effect.andThen(
          storage.setItem(cacheKey, "{}"),
          storage.getItem(cacheKey)
        )
      )
    );

    expect(read).toEqual(Option.some("{}"));
  });

  test("refuses a key the exit cleanup wouldn't remove", async () => {
    const setup = deviceWithFence();

    const exit = await Effect.runPromiseExit(
      withAccountStorage(setup, (storage) =>
        storage.setItem("deskohub.profile-draft", "{}")
      )
    );

    expect(exit._tag).toBe("Failure");
    expect(setup.device.storage.size).toBe(0);
  });

  test("undoes a write that lands after the account exited", async () => {
    const setup = deviceWithFence();
    const landed = await Effect.runPromise(Deferred.make<void>());
    // A device write that takes until `landed` completes.
    const slowDevice = Layer.succeed(DeviceStorage, {
      getItem: () => Effect.succeed(Option.none()),
      setItem: (key, value) =>
        Effect.andThen(
          Deferred.await(landed),
          Effect.sync(() => {
            setup.device.storage.set(key, value);
          })
        ),
      removeItems: (keys) =>
        Effect.sync(() => {
          for (const key of keys) setup.device.storage.delete(key);
        }),
      keys: Effect.sync(() => [...setup.device.storage.keys()]),
    });
    const capabilities = Layer.merge(slowDevice, setup.capabilities);

    await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* AccountScopedStorage;
        const write = yield* Effect.forkChild(storage.setItem(cacheKey, "{}"));
        yield* Effect.yieldNow;
        yield* setup.exit;
        yield* Deferred.succeed(landed, undefined);
        yield* Fiber.join(write);
      }).pipe(Effect.provide(accountDeviceLayer(capabilities, setup.fence)))
    );

    expect(setup.device.storage.has(cacheKey)).toBe(false);
  });

  test("writes nothing once the account exited, and a new sign-in starts fresh", async () => {
    const setup = deviceWithFence();

    const beforeExitStorage = await Effect.runPromise(
      Effect.service(AccountScopedStorage).pipe(
        Effect.provide(accountDeviceLayer(setup.capabilities, setup.fence))
      )
    );
    await Effect.runPromise(setup.exit);
    await Effect.runPromise(beforeExitStorage.setItem(cacheKey, "stale"));
    const staleRead = await Effect.runPromise(
      beforeExitStorage.getItem(cacheKey)
    );

    expect(setup.device.storage.has(cacheKey)).toBe(false);
    expect(staleRead).toEqual(Option.none());

    // The same account signs in again: its new runtime opens a new window.
    const read = await Effect.runPromise(
      withAccountStorage(setup, (storage) =>
        Effect.andThen(
          storage.setItem(cacheKey, "fresh"),
          storage.getItem(cacheKey)
        )
      )
    );

    expect(read).toEqual(Option.some("fresh"));
  });

  test("removes a temporary file written while the account exited", async () => {
    const setup = deviceWithFence();
    const storage = await Effect.runPromise(
      Effect.service(AccountScopedStorage).pipe(
        Effect.provide(accountDeviceLayer(setup.capabilities, setup.fence))
      )
    );

    const before = await Effect.runPromise(
      storage.writeTemporaryFile("invoice.pdf", new Uint8Array([1]))
    );
    await Effect.runPromise(setup.exit);
    const after = await Effect.runPromise(
      storage.writeTemporaryFile("invoice-2.pdf", new Uint8Array([2]))
    );

    expect(Option.isSome(before)).toBe(true);
    expect(after).toEqual(Option.none());
    expect(setup.device.files.size).toBe(0);
  });
});
