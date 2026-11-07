import { Context, Effect, Layer, Option } from "effect";
import { CustomerAccountScope } from "./customer-api.service";
import {
  type DeviceCapabilities,
  type DeviceCapabilityFailed,
  DeviceStorage,
  TemporaryFiles,
} from "./device-capabilities";

/**
 * The storage namespaces the app keeps per signed-in account: the
 * reservations offline cache and the booking flow's remembered referral code.
 * An account's entries go when it exits (sign-out, expiry or switch).
 */
export const exitClearedStoragePrefixes = [
  "deskohub.reservations.v1.",
  "deskohub.booking.",
] as const;

export const isExitClearedKey = (key: string) =>
  exitClearedStoragePrefixes.some((prefix) => key.startsWith(prefix));

/**
 * The device key of an account's entry: the entry's name, then the API
 * origin and account, as in `deskohub.reservations.v1.<origin>.<account>`.
 */
export const accountStorageKey = (
  name: string,
  scope: { readonly apiOrigin: string; readonly accountId: string }
) => `${name}.${scope.apiOrigin}.${encodeURIComponent(scope.accountId)}`;

/** Whether a device key holds an entry of the account. */
export const isAccountStorageKey = (key: string, accountId: string) =>
  isExitClearedKey(key) && key.endsWith(`.${encodeURIComponent(accountId)}`);

interface IAccountExitFence {
  /** Advances each time the account exits, before its cleanup runs. */
  readonly generation: (accountId: string) => Effect.Effect<number>;
  readonly advance: (accountId: string) => Effect.Effect<void>;
}

/**
 * Orders an account's device writes against its exit. Device writes can't be
 * cancelled, so one in flight when the account exits could land after the
 * cleanup; a write that sees its account's fence moved undoes itself. Each
 * account has its own fence, so another account signing in meanwhile is
 * unaffected.
 */
export class AccountExitFence extends Context.Service<
  AccountExitFence,
  IAccountExitFence
>()("AccountExitFence") {
  /** The app's one fence, shared by the exit cleanup and every account. */
  static Default = Layer.sync(this, () => appExitFence);
}

export const makeAccountExitFence = (): IAccountExitFence => {
  const generations = new Map<string, number>();
  return {
    generation: (accountId) =>
      Effect.sync(() => generations.get(accountId) ?? 0),
    advance: (accountId) =>
      Effect.sync(() => {
        generations.set(accountId, (generations.get(accountId) ?? 0) + 1);
      }),
  };
};

const appExitFence = makeAccountExitFence();

interface IAccountScopedStorage {
  /** `name` starts with an `exitClearedStoragePrefixes` namespace. */
  readonly getItem: (
    name: string
  ) => Effect.Effect<Option.Option<string>, DeviceCapabilityFailed>;
  readonly setItem: (
    name: string,
    value: string
  ) => Effect.Effect<void, DeviceCapabilityFailed>;
  readonly removeItem: (
    name: string
  ) => Effect.Effect<void, DeviceCapabilityFailed>;
  /**
   * A temporary file for the share sheet, in the account's own folder; none
   * when the account exited before it landed.
   */
  readonly writeTemporaryFile: (
    name: string,
    bytes: Uint8Array
  ) => Effect.Effect<Option.Option<string>, DeviceCapabilityFailed>;
}

/**
 * The signed-in account's device storage and temporary files. Use it, not
 * `DeviceStorage`, for anything kept per account: it keys entries by origin
 * and account, refuses names the exit cleanup wouldn't remove, and fences
 * writes against the account's exit.
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
      const scope = yield* CustomerAccountScope;
      const opened = yield* fence.generation(scope.accountId);
      const stillSignedIn = Effect.map(
        fence.generation(scope.accountId),
        (generation) => generation === opened
      );
      const keyOf = (name: string) =>
        isExitClearedKey(`${name}.`)
          ? Effect.succeed(accountStorageKey(name, scope))
          : Effect.die(
              new Error(
                `"${name}" is not cleared on exit; start it with one of exitClearedStoragePrefixes`
              )
            );
      return {
        getItem: (name) =>
          Effect.gen(function* () {
            const key = yield* keyOf(name);
            if (!(yield* stillSignedIn)) return Option.none();
            return yield* storage.getItem(key);
          }),
        // The write and its fence check run uninterruptibly: an interrupted
        // fiber would otherwise skip the check while the write still lands.
        setItem: (name, value) =>
          Effect.gen(function* () {
            const key = yield* keyOf(name);
            if (!(yield* stillSignedIn)) return;
            yield* storage.setItem(key, value);
            // The account exited while the write was in flight; its cleanup
            // may have run before the write landed.
            if (!(yield* stillSignedIn)) yield* storage.removeItems([key]);
          }).pipe(Effect.uninterruptible),
        removeItem: (name) =>
          Effect.flatMap(keyOf(name), (key) => storage.removeItems([key])),
        writeTemporaryFile: (name, bytes) =>
          Effect.gen(function* () {
            if (!(yield* stillSignedIn)) return Option.none();
            const uri = yield* temporaryFiles.write(
              scope.accountId,
              name,
              bytes
            );
            if (yield* stillSignedIn) return Option.some(uri);
            yield* temporaryFiles.remove(uri);
            return Option.none();
          }).pipe(Effect.uninterruptible),
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
): Layer.Layer<
  DeviceCapabilities | AccountExitFence | AccountScopedStorage,
  never,
  CustomerAccountScope
> =>
  AccountScopedStorage.Default.pipe(
    Layer.provideMerge(Layer.merge(device, fence))
  );
