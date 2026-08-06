import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  type PlatformError,
  Schema,
} from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { ReleaseBuildTarget } from "../build-info";
import { DhwConfig } from "../config/dhw-config.service";

export const AvailableUpdate = Schema.Struct({
  version: Schema.String,
  releaseUrl: Schema.String,
  assetUrl: Schema.String,
  assetDigest: Schema.String,
  assetSize: Schema.Number,
  target: ReleaseBuildTarget,
});

export type AvailableUpdate = typeof AvailableUpdate.Type;

const UpdateState = Schema.Struct({
  lastAttemptedAt: Schema.optionalKey(Schema.Number),
  lastSuccessfulAt: Schema.optionalKey(Schema.Number),
  etag: Schema.optionalKey(Schema.String),
  available: Schema.optionalKey(AvailableUpdate),
});

export type UpdateState = typeof UpdateState.Type;

interface IUpdateStateStore {
  readonly get: Effect.Effect<
    UpdateState,
    | KeyValueStore.KeyValueStoreError
    | PlatformError.PlatformError
    | Schema.SchemaError
  >;
  readonly set: (
    state: UpdateState
  ) => Effect.Effect<
    void,
    | KeyValueStore.KeyValueStoreError
    | PlatformError.PlatformError
    | Schema.SchemaError
  >;
}

export class UpdateStateStore extends Context.Service<
  UpdateStateStore,
  IUpdateStateStore
>()("UpdateStateStore") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* DhwConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const storeLayer = KeyValueStore.layerFileSystem(
        config.stateDirectory
      ).pipe(
        Layer.provide(Layer.succeed(FileSystem.FileSystem, fileSystem)),
        Layer.provide(Layer.succeed(Path.Path, path))
      );

      return yield* makeUpdateStateStore(storeLayer);
    })
  );
}

function makeUpdateStateStore(
  storeLayer: Layer.Layer<
    KeyValueStore.KeyValueStore,
    PlatformError.PlatformError
  >
) {
  const get = Effect.gen(function* () {
    const keyValueStore = yield* KeyValueStore.KeyValueStore;
    return yield* KeyValueStore.toSchemaStore(keyValueStore, UpdateState).get(
      "update"
    );
  }).pipe(
    Effect.map(Option.getOrElse((): UpdateState => ({}))),
    Effect.provide(storeLayer)
  );

  const set = (state: UpdateState) =>
    Effect.gen(function* () {
      const keyValueStore = yield* KeyValueStore.KeyValueStore;
      yield* KeyValueStore.toSchemaStore(keyValueStore, UpdateState).set(
        "update",
        state
      );
    }).pipe(Effect.provide(storeLayer));

  return Effect.succeed({
    get,
    set: Effect.fn("UpdateStateStore.set")(set),
  });
}
