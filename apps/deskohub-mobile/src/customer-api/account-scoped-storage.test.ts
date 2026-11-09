import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Fiber, Layer, Option, Scope } from "effect";
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
      await run(
        Effect.scoped(storage.temporaryFile("invoice.pdf", new Uint8Array()))
      )
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
        await run(
          Effect.scoped(
            second.temporaryFile("invoice.pdf", new Uint8Array([1]))
          )
        )
      )
    ).toBe(true);
  });

  test("a temporary file lasts for its scope, through its session's exit", async () => {
    const setup = deviceWithFence();
    const storage = await openStorage(setup, sessionA1);

    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const uri = yield* storage.temporaryFile(
            "invoice.pdf",
            new Uint8Array()
          );
          yield* setup.exit(sessionA1);
          expect([...setup.device.files.keys()]).toEqual([
            ...Option.toArray(uri),
          ]);
        })
      )
    );

    expect(setup.device.files.size).toBe(0);
  });

  test("a launch sweep that waited for a held file runs when its scope closes", async () => {
    const setup = deviceWithFence();
    const orphan = "file:///cache/deskohub-share/b/0/invoice.pdf";
    setup.device.files.set(orphan, new Uint8Array());
    const storage = await openStorage(setup, sessionA1);
    const launchSweep = customerDataExitCleanup({ scope: "shared-files" }).pipe(
      Effect.provide(Layer.merge(setup.capabilities, setup.fence))
    );

    await run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* storage.temporaryFile("invoice.pdf", new Uint8Array());
          yield* launchSweep;
          expect(setup.device.files.has(orphan)).toBe(true);
        })
      )
    );

    expect(setup.device.files.size).toBe(0);
  });

  test("temporary files of one name are separate files, each removed with its own scope", async () => {
    const setup = deviceWithFence();
    const storage = await openStorage(setup, sessionA1);
    const file = (scope: Scope.Closeable) =>
      storage
        .temporaryFile("invoice.pdf", new Uint8Array())
        .pipe(Scope.provide(scope), Effect.map(Option.getOrThrow));

    await run(
      Effect.gen(function* () {
        const firstScope = yield* Scope.make();
        const secondScope = yield* Scope.make();
        const first = yield* file(firstScope);
        const second = yield* file(secondScope);
        expect(first).not.toBe(second);

        yield* Scope.close(firstScope, Exit.void);
        expect([...setup.device.files.keys()]).toEqual([second]);
        yield* Scope.close(secondScope, Exit.void);
        expect(setup.device.files.size).toBe(0);
      })
    );
  });
});

describe("AccountExitFence", () => {
  const current = (
    fence: ReturnType<typeof makeAccountExitFence>,
    session: AccountSession
  ) => Effect.runSync(fence.isCurrent(session));

  test("a closed session never becomes current again", () => {
    const fence = makeAccountExitFence();
    Effect.runSync(fence.open(sessionA1));
    Effect.runSync(fence.close(sessionA1));
    Effect.runSync(fence.open(sessionA1));

    expect(current(fence, sessionA1)).toBe(false);
  });

  test("an exit that arrives before its session opened still closes it", () => {
    const fence = makeAccountExitFence();
    Effect.runSync(fence.close(sessionA1));
    Effect.runSync(fence.open(sessionA1));

    expect(current(fence, sessionA1)).toBe(false);
  });

  test("a later sign-in of the account opens after an exit", () => {
    const fence = makeAccountExitFence();
    Effect.runSync(fence.open(sessionA1));
    Effect.runSync(fence.close(sessionA1));
    Effect.runSync(fence.open(sessionA2));

    expect(current(fence, sessionA2)).toBe(true);
    expect(current(fence, sessionA1)).toBe(false);
  });

  test("a file sweep waits while files are held, and is due at the last release", () => {
    const fence = makeAccountExitFence();
    Effect.runSync(fence.holdFile("first"));
    Effect.runSync(fence.holdFile("second"));

    expect(Effect.runSync(fence.fileSweepNow)).toBe(false);
    expect(Effect.runSync(fence.releaseFile("first"))).toBe(false);
    expect(Effect.runSync(fence.releaseFile("second"))).toBe(true);
    Effect.runSync(fence.holdFile("third"));
    expect(Effect.runSync(fence.releaseFile("third"))).toBe(false);
  });

  test("a file sweep runs at once when no file is held", () => {
    const fence = makeAccountExitFence();

    expect(Effect.runSync(fence.fileSweepNow)).toBe(true);
    Effect.runSync(fence.holdFile("only"));
    expect(Effect.runSync(fence.releaseFile("only"))).toBe(false);
  });

  test("an older session can't take over from a newer one", () => {
    const fence = makeAccountExitFence();
    Effect.runSync(fence.open(sessionA2));
    Effect.runSync(fence.open(sessionA1));

    expect(current(fence, sessionA2)).toBe(true);
    expect(current(fence, sessionA1)).toBe(false);
  });
});
