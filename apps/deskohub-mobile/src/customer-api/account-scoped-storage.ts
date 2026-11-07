import { Context, Effect, Layer, Option, Semaphore } from "effect";
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

/** One sign-in of an account, told apart by when it started. */
export interface AccountSession {
  readonly accountId: string;
  readonly sessionStartedAt: number;
}

interface IAccountExitFence {
  /**
   * Runs `effect` alone: no other account-storage operation, session opening
   * or exit cleanup interleaves with it.
   */
  readonly exclusive: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
  /** Records that the session's storage opened (the account's latest). */
  readonly open: (session: AccountSession) => Effect.Effect<void>;
  /**
   * Whether the session may still use its storage: no exit closed it and no
   * later session of the account opened.
   */
  readonly isCurrent: (session: AccountSession) => Effect.Effect<boolean>;
  /**
   * Closes the account's storage for an exit of `session`; answers whether
   * the exit may remove the account's data, which it may not once a later
   * session of the account has opened.
   */
  readonly close: (session: AccountSession) => Effect.Effect<boolean>;
  /** Accounts with a session whose storage is open. */
  readonly openAccounts: Effect.Effect<ReadonlySet<string>>;
}

/**
 * Orders account storage against account exits. Every storage operation and
 * every exit cleanup runs alone (`exclusive`) and checks which session it
 * belongs to, so a session that has exited (or been succeeded) can't write,
 * and an exit's cleanup never removes data of a session that opened after
 * it. Device writes can't be cancelled; holding the lock until one lands
 * keeps a cleanup from running in the middle of it.
 */
export class AccountExitFence extends Context.Service<
  AccountExitFence,
  IAccountExitFence
>()("AccountExitFence") {
  /** The app's one fence, shared by the exit cleanup and every account. */
  static Default = Layer.sync(this, () => appExitFence);
}

export const makeAccountExitFence = (): IAccountExitFence => {
  // Per account: the latest session that opened its storage, and the latest
  // sign-in time an exit has closed. A session that started at or before the
  // closed time never opens again, whatever order the calls arrive in.
  const accounts = new Map<
    string,
    { open: number | undefined; closedUpTo: number }
  >();
  const stateOf = (accountId: string) => {
    const known = accounts.get(accountId);
    if (known !== undefined) return known;
    const created = { open: undefined, closedUpTo: Number.NEGATIVE_INFINITY };
    accounts.set(accountId, created);
    return created;
  };
  const lock = Semaphore.makeUnsafe(1);
  return {
    exclusive: (effect) => lock.withPermit(effect),
    open: ({ accountId, sessionStartedAt }) =>
      Effect.sync(() => {
        const state = stateOf(accountId);
        if (sessionStartedAt <= state.closedUpTo) return;
        if (state.open === undefined || state.open <= sessionStartedAt) {
          state.open = sessionStartedAt;
        }
      }),
    isCurrent: ({ accountId, sessionStartedAt }) =>
      Effect.sync(() => {
        const state = stateOf(accountId);
        return (
          state.open === sessionStartedAt && sessionStartedAt > state.closedUpTo
        );
      }),
    close: ({ accountId, sessionStartedAt }) =>
      Effect.sync(() => {
        const state = stateOf(accountId);
        state.closedUpTo = Math.max(state.closedUpTo, sessionStartedAt);
        // A later sign-in of the same account owns the entries now.
        if (state.open !== undefined && state.open > sessionStartedAt) {
          return false;
        }
        state.open = undefined;
        return true;
      }),
    openAccounts: Effect.sync(
      () =>
        new Set(
          [...accounts]
            .filter(([, state]) => state.open !== undefined)
            .map(([accountId]) => accountId)
        )
    ),
  };
};

const appExitFence = makeAccountExitFence();

interface IAccountScopedStorage {
  /** `name` starts with an `exitClearedStoragePrefixes` namespace. */
  readonly getItem: (
    name: string
  ) => Effect.Effect<Option.Option<string>, DeviceCapabilityFailed>;
  /** Does nothing once the session has exited. */
  readonly setItem: (
    name: string,
    value: string
  ) => Effect.Effect<void, DeviceCapabilityFailed>;
  readonly removeItem: (
    name: string
  ) => Effect.Effect<void, DeviceCapabilityFailed>;
  /**
   * A temporary file for the share sheet, in the account's own folder; none
   * once the session has exited.
   */
  readonly writeTemporaryFile: (
    name: string,
    bytes: Uint8Array
  ) => Effect.Effect<Option.Option<string>, DeviceCapabilityFailed>;
}

/**
 * The signed-in session's device storage and temporary files. Use it, not
 * `DeviceStorage`, for anything kept per account: it keys entries by origin
 * and account, refuses names the exit cleanup wouldn't remove, and orders
 * every operation against the account's exit through `AccountExitFence`.
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
      yield* fence.exclusive(fence.open(scope));
      // Runs alone and uninterruptibly (a device write lands either way), and
      // only while this session is current.
      const whileCurrent = <A, E>(
        operation: Effect.Effect<A, E>,
        otherwise: A
      ): Effect.Effect<A, E> =>
        fence
          .exclusive(
            Effect.flatMap(fence.isCurrent(scope), (current) =>
              current ? operation : Effect.succeed(otherwise)
            )
          )
          .pipe(Effect.uninterruptible);
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
          Effect.flatMap(keyOf(name), (key) =>
            whileCurrent(storage.getItem(key), Option.none())
          ),
        setItem: (name, value) =>
          Effect.flatMap(keyOf(name), (key) =>
            whileCurrent(storage.setItem(key, value), undefined)
          ),
        removeItem: (name) =>
          Effect.flatMap(keyOf(name), (key) =>
            whileCurrent(storage.removeItems([key]), undefined)
          ),
        writeTemporaryFile: (name, bytes) =>
          whileCurrent(
            Effect.map(
              temporaryFiles.write(scope.accountId, name, bytes),
              Option.some
            ),
            Option.none()
          ),
      };
    })
  );
}

/**
 * The device capabilities with the session's fenced storage over them, for a
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
