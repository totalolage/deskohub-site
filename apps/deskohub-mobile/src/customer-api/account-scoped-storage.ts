import { Context, Effect, Layer, Option, type Scope, Semaphore } from "effect";
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
  /**
   * Records that a share still uses the temporary file at `uri`, so no exit
   * removes it until `releaseFile`.
   */
  readonly holdFile: (uri: string) => Effect.Effect<void>;
  /**
   * Ends the hold on the file; answers whether an exit's file sweep waited
   * for it, which is due now that no file is held.
   */
  readonly releaseFile: (uri: string) => Effect.Effect<boolean>;
  /**
   * Whether an exit may remove temporary files now: none is held. Otherwise
   * the sweep waits, and the release of the last held file answers that it
   * is due.
   */
  readonly fileSweepNow: Effect.Effect<boolean>;
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
  // Files an open share uses, and whether an exit's file sweep waits for
  // them. Every live temporary file is held from its write to its removal,
  // so with none held, anything left is a leftover any sweep may remove.
  const heldFiles = new Set<string>();
  let sweepWaiting = false;
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
    holdFile: (uri) =>
      Effect.sync(() => {
        heldFiles.add(uri);
      }),
    releaseFile: (uri) =>
      Effect.sync(() => {
        heldFiles.delete(uri);
        const due = sweepWaiting && heldFiles.size === 0;
        if (due) sweepWaiting = false;
        return due;
      }),
    fileSweepNow: Effect.sync(() => {
      if (heldFiles.size === 0) return true;
      sweepWaiting = true;
      return false;
    }),
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
   * A new temporary file for the share sheet, in the account's own folder,
   * for the scope's lifetime: no exit removes it before the scope closes,
   * and closing the scope removes it, whatever happened to the session
   * meanwhile. None once the session has exited.
   */
  readonly temporaryFile: (
    name: string,
    bytes: Uint8Array
  ) => Effect.Effect<
    Option.Option<string>,
    DeviceCapabilityFailed,
    Scope.Scope
  >;
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
    Effect.Do.pipe(
      Effect.bind("storage", () => Effect.service(DeviceStorage)),
      Effect.bind("temporaryFiles", () => Effect.service(TemporaryFiles)),
      Effect.bind("fence", () => Effect.service(AccountExitFence)),
      Effect.bind("scope", () => Effect.service(CustomerAccountScope)),
      Effect.tap(({ fence, scope }) => fence.exclusive(fence.open(scope))),
      Effect.map((capabilities) => fencedStorageOf(capabilities))
    )
  );
}

interface FencedStorageInput {
  readonly storage: DeviceStorage["Service"];
  readonly temporaryFiles: TemporaryFiles["Service"];
  readonly fence: AccountExitFence["Service"];
  readonly scope: CustomerAccountScope["Service"];
}

const fencedStorageOf = ({
  storage,
  temporaryFiles,
  fence,
  scope,
}: FencedStorageInput): IAccountScopedStorage => {
  // Runs alone and uninterruptibly (a device write lands either way), and
  // only while this session is current.
  const whileCurrent = <A, E>(
    operation: Effect.Effect<A, E>,
    otherwise: A
  ): Effect.Effect<A, E> =>
    operation.pipe(
      Effect.when(fence.isCurrent(scope)),
      Effect.map(Option.getOrElse(() => otherwise)),
      (current) => fence.exclusive(current),
      Effect.uninterruptible
    );
  // Removes the file and ends its hold, then runs the file sweep an exit
  // left waiting for it. It runs alone but whatever the session: the file
  // goes even when the account has exited or signed in again meanwhile.
  const releaseTemporaryFile = (uri: string) =>
    temporaryFiles.remove(uri).pipe(
      Effect.andThen(fence.releaseFile(uri)),
      Effect.flatMap((sweepDue) =>
        sweepDue ? temporaryFiles.sweep(Option.none()) : Effect.void
      ),
      (release) => fence.exclusive(release)
    );
  const keyOf = (name: string) =>
    Effect.succeed(name).pipe(
      Effect.filterOrElse(
        (prefixed) => isExitClearedKey(`${prefixed}.`),
        (unprefixed) =>
          Effect.die(
            new Error(
              `"${unprefixed}" is not cleared on exit; start it with one of exitClearedStoragePrefixes`
            )
          )
      ),
      Effect.map((prefixed) => accountStorageKey(prefixed, scope))
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
    temporaryFile: (name, bytes) =>
      Effect.acquireRelease(
        whileCurrent(
          temporaryFiles
            .write(scope.accountId, name, bytes)
            .pipe(Effect.tap(fence.holdFile), Effect.map(Option.some)),
          Option.none()
        ),
        Option.match({
          onNone: () => Effect.void,
          onSome: releaseTemporaryFile,
        })
      ),
  };
};

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
