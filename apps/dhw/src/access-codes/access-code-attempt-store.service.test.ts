import { describe, expect, test } from "bun:test";
import {
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreateInputType,
  CliSessionId,
} from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Crypto, Effect, Layer, Schema } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import {
  type AccessCodeAttemptIdentity,
  accessCodeAttemptReservationKey,
  makeAccessCodeAttemptStore,
} from "./access-code-attempt-store.service";

const sessionIdFor = (uuid: string) =>
  Schema.decodeUnknownSync(CliSessionId)(uuid);

const requestFor = (
  name: string
): AdministrationStandaloneAccessCodeCreateInputType =>
  Schema.decodeUnknownSync(AdministrationStandaloneAccessCodeCreateInput)({
    name,
    startsAt: "2026-09-10T10:00",
    endsAt: "2026-09-10T12:00",
  });

const identityA = {
  sessionId: sessionIdFor("01980000-0000-7000-8000-000000000001"),
  request: requestFor("Booth A"),
} satisfies AccessCodeAttemptIdentity;
const identityB = {
  sessionId: sessionIdFor("01980000-0000-7000-8000-000000000001"),
  request: requestFor("Booth B"),
} satisfies AccessCodeAttemptIdentity;
const identityOtherSession = {
  sessionId: sessionIdFor("01980000-0000-7000-8000-000000000002"),
  request: requestFor("Booth A"),
} satisfies AccessCodeAttemptIdentity;

const makeMemoryKv = Effect.gen(function* () {
  const keyValueStore = yield* KeyValueStore.KeyValueStore;
  return keyValueStore;
}).pipe(Effect.provide(KeyValueStore.layerMemory));

const makeStore = (keyValueStore: KeyValueStore.KeyValueStore) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    return yield* makeAccessCodeAttemptStore({
      storeLayer: Layer.succeed(KeyValueStore.KeyValueStore, keyValueStore),
      crypto,
    });
  }).pipe(Effect.provide(BunServices.layer));

const withoutRemove = (keyValueStore: KeyValueStore.KeyValueStore) =>
  ({
    ...keyValueStore,
    remove: (key: string) =>
      Effect.fail(
        new KeyValueStore.KeyValueStoreError({
          message: "remove is unavailable",
          method: "remove",
          key,
        })
      ),
  }) as KeyValueStore.KeyValueStore;

const withoutSet = (keyValueStore: KeyValueStore.KeyValueStore) =>
  ({
    ...keyValueStore,
    set: () =>
      Effect.fail(
        new KeyValueStore.KeyValueStoreError({
          message: "set is unavailable",
          method: "set",
          key: "any",
        })
      ),
  }) as KeyValueStore.KeyValueStore;

describe("AccessCodeAttemptStore", () => {
  test("keeps reservations independent per session and request identity", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* makeStore(yield* makeMemoryKv);
      const firstWindowA = yield* store.reserve(identityA);
      const windowB = yield* store.reserve(identityB);
      const otherSession = yield* store.reserve(identityOtherSession);
      const windowARerun = yield* store.reserve(identityA);
      return { firstWindowA, windowB, otherSession, windowARerun };
    }).pipe(Effect.runPromise);

    expect(result.windowB).not.toBe(result.firstWindowA);
    expect(result.otherSession).not.toBe(result.firstWindowA);
    expect(result.windowARerun).toBe(result.firstWindowA);
  });

  test("reserves a fresh id after release when physical deletion fails", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* makeStore(withoutRemove(yield* makeMemoryKv));
      const first = yield* store.reserve(identityA);
      yield* store.forget(identityA, first);
      const second = yield* store.reserve(identityA);
      return { first, second };
    }).pipe(Effect.runPromise);

    expect(result.second).not.toBe(result.first);
  });

  test("reserves a fresh id after a successful release", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* makeStore(yield* makeMemoryKv);
      const first = yield* store.reserve(identityA);
      yield* store.forget(identityA, first);
      const second = yield* store.reserve(identityA);
      return { first, second };
    }).pipe(Effect.runPromise);

    expect(result.second).not.toBe(result.first);
  });

  test("keeps a reservation that a different attempt id tried to release", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* makeStore(yield* makeMemoryKv);
      const first = yield* store.reserve(identityA);
      yield* store.forget(
        identityA,
        Schema.decodeUnknownSync(AdministrationStandaloneAccessCodeAttemptId)(
          "01980000-0000-7000-8000-000000000009"
        )
      );
      const rerun = yield* store.reserve(identityA);
      return { first, rerun };
    }).pipe(Effect.runPromise);

    expect(result.rerun).toBe(result.first);
  });

  test("fails closed on a malformed matching record without affecting other identities", async () => {
    const result = await Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const keyValueStore = yield* makeMemoryKv;
      const store = yield* makeStore(keyValueStore);
      yield* store.reserve(identityA);
      const key = yield* accessCodeAttemptReservationKey({
        crypto,
        identity: identityA,
      });
      yield* keyValueStore.set(key, "{not valid json");
      const malformedError = yield* Effect.flip(store.reserve(identityA));
      const unaffected = yield* store.reserve(identityB);
      return { malformedError, unaffected };
    }).pipe(Effect.provide(BunServices.layer), Effect.runPromise);

    expect(
      result.malformedError instanceof Schema.SchemaError ||
        result.malformedError instanceof KeyValueStore.KeyValueStoreError
    ).toBe(true);
    expect(result.unaffected).toBeDefined();
  });

  test("fails closed when the reservation cannot be written", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* makeStore(withoutSet(yield* makeMemoryKv));
      return yield* Effect.flip(store.reserve(identityA));
    }).pipe(Effect.runPromise);

    expect(result).toBeInstanceOf(KeyValueStore.KeyValueStoreError);
  });
});
