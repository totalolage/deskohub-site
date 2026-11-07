import { Context, Effect, Layer, Option } from "effect";
import {
  type DeviceCapabilities,
  type DeviceCapabilityFailed,
  DeviceStorage,
  TemporaryFiles,
} from "./device-capabilities";

interface IAccountExitFence {
  /** Advances on every account exit, before its cleanup runs. */
  readonly generation: Effect.Effect<number>;
  readonly advance: Effect.Effect<void>;
}

/**
 * Orders an account's device writes against its exit. Device writes can't be
 * cancelled, so one still in flight when the account exits could land after
 * the cleanup; a write that sees the fence moved undoes itself.
 */
export class AccountExitFence extends Context.Service<
  AccountExitFence,
  IAccountExitFence
>()("AccountExitFence") {
  /** The app's one fence, shared by the exit cleanup and every account. */
  static Default = Layer.sync(this, () => appExitFence);
}

export const makeAccountExitFence = (): IAccountExitFence => {
  let generation = 0;
  return {
    generation: Effect.sync(() => generation),
    advance: Effect.sync(() => {
      generation += 1;
    }),
  };
};

const appExitFence = makeAccountExitFence();

/**
 * Storage the app keeps per signed-in account. Every key with one of these
 * prefixes goes when the account exits (sign-out, expiry or account switch):
 * the reservations offline cache and the booking flow's remembered referral
 * code live here.
 */
export const exitClearedStoragePrefixes = [
  "deskohub.reservations.v1.",
  "deskohub.booking.",
] as const;

export const isExitClearedKey = (key: string) =>
  exitClearedStoragePrefixes.some((prefix) => key.startsWith(prefix));

interface IAccountScopedStorage {
  readonly getItem: (
    key: string
  ) => Effect.Effect<Option.Option<string>, DeviceCapabilityFailed>;
  readonly setItem: (
    key: string,
    value: string
  ) => Effect.Effect<void, DeviceCapabilityFailed>;
  readonly removeItem: (
    key: string
  ) => Effect.Effect<void, DeviceCapabilityFailed>;
  /** A temporary file for the share sheet; removed again if the account exits meanwhile. */
  readonly writeTemporaryFile: (
    name: string,
    bytes: Uint8Array
  ) => Effect.Effect<Option.Option<string>, DeviceCapabilityFailed>;
}

/**
 * The signed-in account's device storage and temporary files. Use it, not
 * `DeviceStorage`, for anything kept per account: it refuses keys the exit
 * cleanup wouldn't remove and fences writes against the account's exit.
 */
export class AccountScopedStorage extends Context.Service<
  AccountScopedStorage,
  IAccountScopedStorage
>()("AccountScopedStorage") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const storage = yield* DeviceStorage;
      const temporaryFiles = yield* TemporaryFiles;
      const fence = yield* AccountExitFence;
      const opened = yield* fence.generation;
      const stillSignedIn = Effect.map(
        fence.generation,
        (generation) => generation === opened
      );
      const requireAccountKey = (key: string) =>
        isExitClearedKey(key)
          ? Effect.void
          : Effect.die(
              new Error(
                `"${key}" is not cleared on exit; start it with one of exitClearedStoragePrefixes`
              )
            );
      return {
        getItem: (key) =>
          Effect.flatMap(stillSignedIn, (signedIn) =>
            signedIn ? storage.getItem(key) : Effect.succeed(Option.none())
          ),
        setItem: (key, value) =>
          Effect.gen(function* () {
            yield* requireAccountKey(key);
            if (!(yield* stillSignedIn)) return;
            yield* storage.setItem(key, value);
            // The account exited while the write was in flight; its cleanup
            // may have run before the write landed.
            if (!(yield* stillSignedIn)) yield* storage.removeItems([key]);
          }),
        removeItem: (key) => storage.removeItems([key]),
        writeTemporaryFile: (name, bytes) =>
          Effect.gen(function* () {
            if (!(yield* stillSignedIn)) return Option.none();
            const uri = yield* temporaryFiles.write(name, bytes);
            if (yield* stillSignedIn) return Option.some(uri);
            yield* temporaryFiles.remove(uri);
            return Option.none();
          }),
      };
    })
  );
}

/**
 * The device capabilities with the account's fenced storage over them, for a
 * data runtime. Tests pass their own fence.
 */
export const accountDeviceLayer = (
  device: Layer.Layer<DeviceCapabilities>,
  fence: Layer.Layer<AccountExitFence> = AccountExitFence.Default
): Layer.Layer<DeviceCapabilities | AccountExitFence | AccountScopedStorage> =>
  AccountScopedStorage.Default.pipe(
    Layer.provideMerge(Layer.merge(device, fence))
  );
