import { describe, expect, test } from "bun:test";
import {
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreateInputType,
  CliSessionId,
} from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Layer, Path, Schema } from "effect";
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

const makeStore = (
  keyValueStore: KeyValueStore.KeyValueStore,
  directory = `/tmp/dhw-store-mem-${crypto.randomUUID()}`
) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* makeAccessCodeAttemptStore({
      storeLayer: Layer.succeed(KeyValueStore.KeyValueStore, keyValueStore),
      crypto,
      fileSystem,
      directory,
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

const makeFileStore = (
  directory: string,
  lockOptions?: { readonly waitMilliseconds: number }
) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const storeLayer = KeyValueStore.layerFileSystem(directory).pipe(
      Layer.provide(Layer.succeed(FileSystem.FileSystem, fileSystem)),
      Layer.provide(Layer.succeed(Path.Path, path))
    );
    return yield* makeAccessCodeAttemptStore({
      storeLayer,
      crypto,
      fileSystem,
      directory,
      ...(lockOptions && { lockOptions }),
    });
  }).pipe(Effect.provide(BunServices.layer));

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

  test("reserves one attempt id across concurrent store instances", async () => {
    const directory = `/tmp/dhw-store-race-${crypto.randomUUID()}`;
    const attemptIds = await Effect.gen(function* () {
      const stores = yield* Effect.all(
        [
          makeFileStore(directory),
          makeFileStore(directory),
          makeFileStore(directory),
        ],
        { concurrency: "unbounded" }
      );
      return yield* Effect.all(
        stores.map((store) => store.reserve(identityA)),
        { concurrency: "unbounded" }
      );
    }).pipe(Effect.runPromise);

    try {
      expect(new Set(attemptIds).size).toBe(1);
    } finally {
      await FileSystem.FileSystem.pipe(
        Effect.flatMap((fileSystem) =>
          fileSystem.remove(directory, { recursive: true })
        ),
        Effect.provide(BunServices.layer),
        Effect.runPromise
      ).catch(() => {});
    }
  });

  test("fails closed while another live process holds the reservation lock", async () => {
    const directory = `/tmp/dhw-store-race-${crypto.randomUUID()}`;
    const error = await Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const holder = yield* makeFileStore(directory);
      yield* holder.reserve(identityA);
      const reservationKey = yield* accessCodeAttemptReservationKey({
        crypto,
        identity: identityA,
      });
      const lockPath = `${directory}/${reservationKey}.lock`;
      yield* fileSystem.writeFileString(lockPath, "another live process");
      const contender = yield* makeFileStore(directory, {
        waitMilliseconds: 300,
      });
      return yield* Effect.flip(contender.reserve(identityA));
    })
      .pipe(Effect.provide(BunServices.layer), Effect.runPromise)
      .finally(() => {
        void FileSystem.FileSystem.pipe(
          Effect.flatMap((fileSystem) =>
            fileSystem.remove(directory, { recursive: true })
          ),
          Effect.provide(BunServices.layer),
          Effect.runPromise
        ).catch(() => {});
      });

    expect(error.message).toContain("locked by another process");
  });

  test("never steals an aged lock and fails closed with manual recovery", async () => {
    const directory = `/tmp/dhw-store-race-${crypto.randomUUID()}`;
    const result = await Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const holder = yield* makeFileStore(directory);
      const firstAttemptId = yield* holder.reserve(identityA);
      const reservationKey = yield* accessCodeAttemptReservationKey({
        crypto,
        identity: identityA,
      });
      const lockPath = `${directory}/${reservationKey}.lock`;
      yield* fileSystem.writeFileString(lockPath, "dead process");
      yield* fileSystem.utimes(
        lockPath,
        new Date(Date.now() - 60_000),
        new Date(Date.now() - 60_000)
      );

      const contender = yield* makeFileStore(directory, {
        waitMilliseconds: 200,
      });
      const error = yield* Effect.flip(contender.reserve(identityA));

      const lockStillPresent = yield* fileSystem.readFileString(lockPath);
      expect(lockStillPresent).toBe("dead process");
      expect(error.message).toContain("locked by another process");
      expect(error.message).toContain(lockPath);

      yield* fileSystem.remove(lockPath);
      const recoveredAttemptId = yield* contender.reserve(identityA);
      return { firstAttemptId, recoveredAttemptId };
    })
      .pipe(Effect.provide(BunServices.layer), Effect.runPromise)
      .finally(() => {
        void FileSystem.FileSystem.pipe(
          Effect.flatMap((fileSystem) =>
            fileSystem.remove(directory, { recursive: true })
          ),
          Effect.provide(BunServices.layer),
          Effect.runPromise
        ).catch(() => {});
      });

    expect(result.recoveredAttemptId).toBe(result.firstAttemptId);
  });

  test("releases only its own lock and leaves a foreign lock untouched", async () => {
    const directory = `/tmp/dhw-store-race-${crypto.randomUUID()}`;
    await Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const store = yield* makeFileStore(directory);
      const attemptId = yield* store.reserve(identityA);
      const reservationKey = yield* accessCodeAttemptReservationKey({
        crypto,
        identity: identityA,
      });
      const lockPath = `${directory}/${reservationKey}.lock`;

      expect(yield* fileSystem.exists(lockPath)).toBe(false);

      yield* fileSystem.writeFileString(lockPath, "owned by someone else");
      const contender = yield* makeFileStore(directory, {
        waitMilliseconds: 200,
      });
      const error = yield* Effect.flip(contender.reserve(identityA));
      expect(error.message).toContain("locked by another process");

      expect(yield* fileSystem.readFileString(lockPath)).toBe(
        "owned by someone else"
      );
      expect(attemptId).toBeDefined();
    })
      .pipe(Effect.provide(BunServices.layer), Effect.runPromise)
      .finally(() => {
        void FileSystem.FileSystem.pipe(
          Effect.flatMap((fileSystem) =>
            fileSystem.remove(directory, { recursive: true })
          ),
          Effect.provide(BunServices.layer),
          Effect.runPromise
        ).catch(() => {});
      });
  });
});
