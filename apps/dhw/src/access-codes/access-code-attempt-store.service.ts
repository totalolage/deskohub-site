import {
  AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeAttemptIdType,
  AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreateInputType,
  CliSessionId,
  type CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import {
  Context,
  Crypto,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  type PlatformError,
  Schema,
} from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { DhwConfig } from "../config/dhw-config.service";

const AccessCodeAttemptReservation = Schema.Struct({
  sessionId: CliSessionId,
  request: AdministrationStandaloneAccessCodeCreateInput,
  attemptId: AdministrationStandaloneAccessCodeAttemptId,
  concluded: Schema.Boolean,
});

type AccessCodeAttemptReservation = typeof AccessCodeAttemptReservation.Type;

export interface AccessCodeAttemptIdentity {
  readonly sessionId: CliSessionIdType;
  readonly request: AdministrationStandaloneAccessCodeCreateInputType;
}

const isReservedFor = (
  reservation: AccessCodeAttemptReservation,
  identity: AccessCodeAttemptIdentity
) =>
  reservation.sessionId === identity.sessionId &&
  reservation.request.name === identity.request.name &&
  reservation.request.startsAt === identity.request.startsAt &&
  reservation.request.endsAt === identity.request.endsAt;

interface IAccessCodeAttemptStore {
  readonly reserve: (
    identity: AccessCodeAttemptIdentity
  ) => Effect.Effect<
    AdministrationStandaloneAccessCodeAttemptIdType,
    | KeyValueStore.KeyValueStoreError
    | Schema.SchemaError
    | PlatformError.PlatformError
  >;
  readonly forget: (
    identity: AccessCodeAttemptIdentity,
    attemptId: AdministrationStandaloneAccessCodeAttemptIdType
  ) => Effect.Effect<void>;
}

export class AccessCodeAttemptStore extends Context.Service<
  AccessCodeAttemptStore,
  IAccessCodeAttemptStore
>()("AccessCodeAttemptStore") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* DhwConfig;
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const storeLayer = KeyValueStore.layerFileSystem(
        config.stateDirectory
      ).pipe(
        Layer.provide(Layer.succeed(FileSystem.FileSystem, fileSystem)),
        Layer.provide(Layer.succeed(Path.Path, path))
      );

      return yield* makeAccessCodeAttemptStore({ storeLayer, crypto });
    })
  );
}

const keyPrefix = "access-code-attempt-";

export const accessCodeAttemptReservationKey = ({
  crypto,
  identity,
}: {
  readonly crypto: Crypto.Crypto;
  readonly identity: AccessCodeAttemptIdentity;
}) => {
  const material = [
    identity.sessionId,
    identity.request.name,
    identity.request.startsAt,
    identity.request.endsAt,
  ].join("\u0000");
  return Effect.map(
    crypto.digest("SHA-256", new TextEncoder().encode(material)),
    (digest) =>
      keyPrefix +
      Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
};

export const makeAccessCodeAttemptStore = ({
  storeLayer,
  crypto,
}: {
  readonly storeLayer: Layer.Layer<
    KeyValueStore.KeyValueStore,
    PlatformError.PlatformError
  >;
  readonly crypto: Crypto.Crypto;
}) => {
  const serviceLayer = Layer.mergeAll(
    storeLayer,
    Layer.succeed(Crypto.Crypto, crypto)
  );

  const reservationKey = (identity: AccessCodeAttemptIdentity) =>
    accessCodeAttemptReservationKey({ crypto, identity });

  const schemaStoreFor = (keyValueStore: KeyValueStore.KeyValueStore) =>
    KeyValueStore.toSchemaStore(keyValueStore, AccessCodeAttemptReservation);

  const readAt = (key: string) =>
    Effect.gen(function* () {
      const keyValueStore = yield* KeyValueStore.KeyValueStore;
      return yield* schemaStoreFor(keyValueStore).get(key);
    });

  const writeAt = (key: string, reservation: AccessCodeAttemptReservation) =>
    Effect.gen(function* () {
      const keyValueStore = yield* KeyValueStore.KeyValueStore;
      yield* schemaStoreFor(keyValueStore).set(key, reservation);
    });

  const removeAt = (key: string) =>
    Effect.gen(function* () {
      const keyValueStore = yield* KeyValueStore.KeyValueStore;
      yield* schemaStoreFor(keyValueStore).remove(key);
    });

  const reserve = (identity: AccessCodeAttemptIdentity) =>
    Effect.gen(function* () {
      const key = yield* reservationKey(identity);
      const existing = yield* readAt(key);
      const reuse =
        Option.isSome(existing) &&
        !existing.value.concluded &&
        isReservedFor(existing.value, identity);
      const attemptId = reuse
        ? existing.value.attemptId
        : AdministrationStandaloneAccessCodeAttemptId.make(
            yield* crypto.randomUUIDv7
          );
      yield* writeAt(key, {
        sessionId: identity.sessionId,
        request: identity.request,
        attemptId,
        concluded: false,
      });
      return attemptId;
    }).pipe(Effect.provide(serviceLayer));

  const forget = (
    identity: AccessCodeAttemptIdentity,
    attemptId: AdministrationStandaloneAccessCodeAttemptIdType
  ) =>
    Effect.gen(function* () {
      const key = yield* reservationKey(identity);
      const existing = yield* readAt(key);
      if (
        Option.isNone(existing) ||
        existing.value.concluded ||
        existing.value.attemptId !== attemptId ||
        !isReservedFor(existing.value, identity)
      ) {
        return;
      }
      yield* removeAt(key).pipe(
        Effect.catch(() =>
          writeAt(key, { ...existing.value, concluded: true }).pipe(
            Effect.catch(() => Effect.void)
          )
        )
      );
    }).pipe(
      Effect.provide(serviceLayer),
      Effect.catch(() => Effect.void)
    );

  return Effect.succeed({
    reserve: Effect.fn("AccessCodeAttemptStore.reserve")(reserve),
    forget: Effect.fn("AccessCodeAttemptStore.forget")(forget),
  });
};
