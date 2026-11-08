import { describe, expect, test } from "bun:test";
import { DateTime, Duration, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import {
  AccountExitFence,
  type AccountScopedStorage,
  accountDeviceLayer,
  accountStorageKey,
  makeAccountExitFence,
} from "../../customer-api/account-scoped-storage";
import { CustomerAccountScope } from "../../customer-api/customer-api.service";
import {
  DeviceCapabilityFailed,
  DeviceStorage,
} from "../../customer-api/device-capabilities";
import {
  type FakeDevice,
  fakeDeviceCapabilities,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { sampleWorkspaceData } from "../../customer-api/testing/sample-fixtures";
import {
  readSavedReservations,
  reservationsCacheName,
  reservationsCacheRetention,
  saveReservations,
} from "./reservations-cache";

const scope = {
  accountId: "cache-account",
  apiOrigin: "https://x.example",
  sessionStartedAt: 1,
};
const cacheKey = accountStorageKey(reservationsCacheName, scope);
const history = sampleWorkspaceData("linked").history;
const listedFields = [
  "id",
  "orderId",
  "product",
  "startsAt",
  "endsAt",
  "setupStartsAt",
  "seats",
  "status",
];

const storageLayer = (device: FakeDevice) =>
  accountDeviceLayer(
    fakeDeviceCapabilities(device),
    Layer.succeed(AccountExitFence, makeAccountExitFence())
  ).pipe(Layer.provide(Layer.succeed(CustomerAccountScope, scope)));

const run = <A, E>(
  device: FakeDevice,
  effect: Effect.Effect<A, E, AccountScopedStorage>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.mergeAll(storageLayer(device), TestClock.layer()))
    )
  );

describe("reservations cache", () => {
  test("reads back what it saved, with when it was saved", async () => {
    const device = makeFakeDevice();

    const saved = await run(
      device,
      Effect.Do.pipe(
        Effect.tap(() => TestClock.setTime(Date.UTC(2026, 10, 1, 9))),
        Effect.tap(() => saveReservations(history)),
        Effect.andThen(readSavedReservations)
      )
    );

    expect(Option.isSome(saved)).toBe(true);
    const value = Option.getOrThrow(saved);
    expect(DateTime.toEpochMillis(value.savedAt)).toBe(
      Date.UTC(2026, 10, 1, 9)
    );
    expect(value.history.current.map((row) => row.id)).toEqual(
      history.current.map((row) => row.id)
    );
    expect(value.history.past.map((row) => row.id)).toEqual(
      history.past.map((row) => row.id)
    );
    expect(value.history.unavailable.map((row) => row.id)).toEqual(
      history.unavailable.map((row) => row.id)
    );
    expect([...device.storage.keys()]).toEqual([cacheKey]);
  });

  test("keeps only what the list shows: never the other party", async () => {
    const device = makeFakeDevice();
    const withParty = [...history.current, ...history.past].filter(
      (row) => row.party !== undefined
    );
    expect(withParty.length).toBeGreaterThan(0);

    const saved = await run(
      device,
      saveReservations({
        ...history,
        current: history.current.map((row) => ({
          ...row,
          reviewSandbox: true as const,
        })),
      }).pipe(Effect.andThen(readSavedReservations))
    );

    const stored = device.storage.get(cacheKey) ?? "";
    expect(stored).not.toContain("party");
    expect(stored).not.toContain("reviewSandbox");
    for (const { party } of withParty) {
      const name =
        party?.kind === "booked-for" ? party.customerName : undefined;
      const author = party?.kind === "booked-by" ? party.authorName : undefined;
      for (const shown of [name, author]) {
        if (shown) expect(stored).not.toContain(shown);
      }
    }
    const rows = Option.getOrThrow(saved).history;
    for (const row of [...rows.current, ...rows.past, ...rows.unavailable]) {
      for (const key of Object.keys(row)) {
        expect(listedFields).toContain(key);
      }
    }
  });

  test("keeps saved reservations for 30 days, then drops them", async () => {
    const device = makeFakeDevice();
    const retention = Duration.toMillis(reservationsCacheRetention);

    const [atLimit, pastLimit] = await run(
      device,
      Effect.Do.pipe(
        Effect.tap(() => saveReservations(history)),
        Effect.tap(() => TestClock.adjust(retention)),
        Effect.bind("atLimit", () => readSavedReservations),
        Effect.tap(() => TestClock.adjust(1)),
        Effect.bind("pastLimit", () => readSavedReservations),
        Effect.map(({ atLimit, pastLimit }) => [atLimit, pastLimit] as const)
      )
    );

    expect(Option.isSome(atLimit)).toBe(true);
    expect(Option.isNone(pastLimit)).toBe(true);
    expect(device.storage.has(cacheKey)).toBe(false);
  });

  test("drops an entry it can't read", async () => {
    for (const unreadable of [
      "not json",
      JSON.stringify({ savedAt: 0, history: { current: "nope" } }),
      JSON.stringify({
        savedAt: 0,
        history: {
          current: [{ id: "x", product: { kind: "spaceship" } }],
          past: [],
          unavailable: [],
        },
      }),
    ]) {
      const device = makeFakeDevice();
      device.storage.set(cacheKey, unreadable);

      const saved = await run(device, readSavedReservations);

      expect(Option.isNone(saved)).toBe(true);
      expect(device.storage.has(cacheKey)).toBe(false);
    }
  });

  test("reads none when the device storage fails", async () => {
    const device = makeFakeDevice();
    const failing = Layer.succeed(DeviceStorage, {
      getItem: () =>
        Effect.fail(new DeviceCapabilityFailed({ capability: "storage" })),
      setItem: () =>
        Effect.fail(new DeviceCapabilityFailed({ capability: "storage" })),
      removeItems: () => Effect.void,
      keys: Effect.succeed([]),
    });
    const layer = accountDeviceLayer(
      Layer.merge(fakeDeviceCapabilities(device), failing),
      Layer.succeed(AccountExitFence, makeAccountExitFence())
    ).pipe(Layer.provide(Layer.succeed(CustomerAccountScope, scope)));

    const saved = await Effect.runPromise(
      saveReservations(history).pipe(
        Effect.andThen(readSavedReservations),
        Effect.provide(layer)
      )
    );

    expect(Option.isNone(saved)).toBe(true);
  });
});
