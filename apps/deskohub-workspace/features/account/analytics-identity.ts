"use client";

import { Option, Schema } from "effect";
import { authClient } from "./auth.client";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "./customer-account";

export type AnalyticsAccountIdentity =
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "anonymous" }
  | { status: "authenticated"; accountId: CustomerAccountId };

type SessionAtomSnapshot = ReturnType<typeof authClient.useSession.get>;
type SessionRefetch = SessionAtomSnapshot["refetch"];
type SessionRefetchOptions = Parameters<SessionRefetch>[0];

const analyticsSessionDataSchema = Schema.NullOr(
  Schema.Struct({
    session: Schema.NullOr(
      Schema.Struct({
        expiresAt: Schema.Date,
      })
    ),
    user: Schema.NullOr(
      Schema.Struct({
        emailVerified: Schema.Boolean,
        id: Schema.Unknown,
      })
    ),
  })
);

const analyticsSessionSnapshotSchema = Schema.Struct({
  data: analyticsSessionDataSchema,
  error: Schema.NullOr(Schema.Unknown),
  isPending: Schema.Boolean,
  isRefetching: Schema.Boolean,
});
const analyticsSessionFlagsSchema = Schema.Struct({
  isPending: Schema.Boolean,
  isRefetching: Schema.Boolean,
});

type ParsedSessionSnapshot = typeof analyticsSessionSnapshotSchema.Type;
type ParsedSessionFlags = typeof analyticsSessionFlagsSchema.Type;

type IdentityFacts = {
  readonly expiresAt?: number;
  readonly identity: AnalyticsAccountIdentity;
};

type LifecycleOverride = "pending" | "anonymous";

type SettledIdentity =
  | { readonly status: "anonymous" }
  | { readonly accountId: CustomerAccountId; readonly status: "authenticated" };

type PublishOptions = {
  readonly suppressSessionChangeNotification?: boolean;
};

type RefreshCycle = {
  readonly promise: Promise<void>;
  readonly reject: (cause: unknown) => void;
  readonly resolve: () => void;
  activeEpoch: number;
  requestedEpoch: number;
};

const sessionAtom = authClient.useSession;
const authoritativeRefreshOptions: SessionRefetchOptions = {
  query: { disableCookieCache: true },
};
const accountSessionChangeStorageKey = "deskohub.account-session-change";

const pendingIdentity: AnalyticsAccountIdentity = { status: "pending" };
const unavailableIdentity: AnalyticsAccountIdentity = {
  status: "unavailable",
};
const anonymousIdentity: AnalyticsAccountIdentity = { status: "anonymous" };

const listeners: Array<() => void> = [];

let publishedIdentity: AnalyticsAccountIdentity = pendingIdentity;
let lastSettledIdentity: SettledIdentity | undefined;
let lifecycleOverride: LifecycleOverride | undefined;
let accountTransitionPending = false;
let completedRefreshEpoch: number | undefined;
let refreshEpoch = 0;
let authorityRefreshPending = false;
let authorityRefreshFailed = false;
let refreshCycle: RefreshCycle | undefined;
let unsubscribeSession: (() => void) | undefined;
let browserListenersCleanup: (() => void) | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let expiryAt: number | undefined;
let expiryRefreshRequested = false;
let externalRefreshRequestedThisTurn = false;

const parseSessionSnapshot = (
  value: SessionAtomSnapshot
): ParsedSessionSnapshot | undefined =>
  Option.getOrUndefined(
    Schema.decodeOption(analyticsSessionSnapshotSchema)(value)
  );

const parseSessionFlags = (
  value: SessionAtomSnapshot
): ParsedSessionFlags | undefined =>
  Option.getOrUndefined(
    Schema.decodeOption(analyticsSessionFlagsSchema)(value)
  );

const sameIdentity = (
  left: AnalyticsAccountIdentity,
  right: AnalyticsAccountIdentity
) => {
  if (left.status !== right.status) return false;
  return (
    left.status !== "authenticated" ||
    (right.status === "authenticated" && left.accountId === right.accountId)
  );
};

const settledIdentityOf = (
  identity: AnalyticsAccountIdentity
): SettledIdentity | undefined => {
  if (identity.status === "pending" || identity.status === "unavailable") {
    return undefined;
  }
  return identity;
};

const readSessionIdentity = (value: SessionAtomSnapshot): IdentityFacts => {
  const flags = parseSessionFlags(value);
  if (flags === undefined) return { identity: unavailableIdentity };
  if (flags.isPending || flags.isRefetching) {
    return { identity: pendingIdentity };
  }

  const snapshot = parseSessionSnapshot(value);
  if (snapshot === undefined) return { identity: unavailableIdentity };

  if (snapshot.error !== null) {
    return { identity: unavailableIdentity };
  }

  const data = snapshot.data;
  if (data === null) {
    return { identity: anonymousIdentity };
  }

  if (data.user === null || data.session === null) {
    return { identity: unavailableIdentity };
  }
  if (data.user.emailVerified !== true) {
    return { identity: unavailableIdentity };
  }

  const expiresAt = data.session.expiresAt;
  const expiresAtMillis = expiresAt.getTime();
  if (!Number.isFinite(expiresAtMillis)) {
    return { identity: unavailableIdentity };
  }
  if (expiresAtMillis <= Date.now()) {
    return { expiresAt: expiresAtMillis, identity: unavailableIdentity };
  }

  let accountId: CustomerAccountId | undefined;
  try {
    accountId = Option.getOrUndefined(
      Schema.decodeUnknownOption(customerAccountIdSchema)(data.user.id)
    );
  } catch {
    return { identity: unavailableIdentity };
  }
  if (accountId === undefined) {
    return { identity: unavailableIdentity };
  }

  return {
    expiresAt: expiresAtMillis,
    identity: { accountId, status: "authenticated" },
  };
};

const readCurrentSession = (): SessionAtomSnapshot => sessionAtom.get();

const clearExpiryTimer = () => {
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  expiryTimer = undefined;
  expiryAt = undefined;
};

const scheduleExpiryTimer = (expiresAt: number | undefined) => {
  if (listeners.length === 0 || expiresAt === undefined) {
    clearExpiryTimer();
    return;
  }

  const delay = expiresAt - Date.now();
  if (delay > 0) expiryRefreshRequested = false;
  if (delay <= 0 && expiryRefreshRequested) {
    clearExpiryTimer();
    return;
  }
  if (delay > 0 && expiryTimer !== undefined && expiryAt === expiresAt) {
    return;
  }

  clearExpiryTimer();
  expiryAt = expiresAt;
  if (delay <= 0) {
    expiryRefreshRequested = true;
    requestExternalRefresh();
    return;
  }
  expiryTimer = setTimeout(
    () => {
      expiryTimer = undefined;
      expiryAt = undefined;
      expiryRefreshRequested = true;
      requestExternalRefresh();
    },
    Math.min(delay, 2_147_483_647)
  );
};

const notifyAccountSessionChange = () => {
  const browserWindow = globalThis.window;
  if (browserWindow === undefined) return;

  try {
    browserWindow.localStorage.setItem(
      accountSessionChangeStorageKey,
      crypto.randomUUID()
    );
  } catch {
    // Storage is an optimization for other tabs, not the local state path.
  }
};

const publish = (
  identity: AnalyticsAccountIdentity,
  options: PublishOptions = {}
) => {
  const settledIdentity = settledIdentityOf(identity);
  const settledIdentityChanged =
    settledIdentity !== undefined &&
    (lastSettledIdentity === undefined ||
      !sameIdentity(lastSettledIdentity, settledIdentity));

  if (settledIdentity !== undefined) lastSettledIdentity = settledIdentity;

  if (sameIdentity(publishedIdentity, identity)) {
    if (settledIdentityChanged && !options.suppressSessionChangeNotification) {
      notifyAccountSessionChange();
    }
    return;
  }

  publishedIdentity = identity;
  for (const listener of [...listeners]) listener();

  if (settledIdentityChanged && !options.suppressSessionChangeNotification) {
    notifyAccountSessionChange();
  }
};

const effectiveIdentityFacts = (): IdentityFacts => {
  if (authorityRefreshPending || lifecycleOverride === "pending") {
    return { identity: pendingIdentity };
  }
  if (authorityRefreshFailed) {
    return { identity: unavailableIdentity };
  }
  if (lifecycleOverride === "anonymous") {
    return { identity: anonymousIdentity };
  }
  return readSessionIdentity(readCurrentSession());
};

function syncAnalyticsIdentity() {
  const facts = effectiveIdentityFacts();
  if (facts.identity.status === "anonymous") expiryRefreshRequested = false;
  publish(facts.identity);
  scheduleExpiryTimer(facts.expiresAt);
}

const clearPendingOverrideAfterRefresh = () => {
  if (lifecycleOverride === "pending" && !accountTransitionPending) {
    lifecycleOverride = undefined;
  }
};

const clearAnonymousOverrideAfterRefresh = (epoch: number) => {
  if (lifecycleOverride !== "anonymous" || epoch !== refreshEpoch) {
    return;
  }

  lifecycleOverride = undefined;
};

const startRefresh = (cycle: RefreshCycle, epoch: number): void => {
  authorityRefreshPending = true;
  authorityRefreshFailed = false;

  cycle.activeEpoch = epoch;

  void (async () => {
    let succeeded = false;
    let cause: unknown;
    try {
      const snapshot = readCurrentSession();
      await snapshot.refetch(authoritativeRefreshOptions);
      succeeded = true;
    } catch (failure) {
      cause = failure;
    } finally {
      finishRefresh(cycle, epoch, succeeded, cause);
    }
  })();
  syncAnalyticsIdentity();
};

const finishRefresh = (
  cycle: RefreshCycle,
  epoch: number,
  succeeded: boolean,
  cause: unknown
) => {
  if (refreshCycle !== cycle || cycle.activeEpoch !== epoch) return;

  const nextEpoch = Math.max(cycle.requestedEpoch, refreshEpoch);
  if (nextEpoch > epoch) {
    cycle.requestedEpoch = nextEpoch;
    startRefresh(cycle, nextEpoch);
    return;
  }

  refreshCycle = undefined;
  authorityRefreshPending = false;
  authorityRefreshFailed = !succeeded;

  if (succeeded) {
    completedRefreshEpoch = epoch;
    clearPendingOverrideAfterRefresh();
  } else {
    completedRefreshEpoch = undefined;
    if (lifecycleOverride === "pending" && !accountTransitionPending) {
      lifecycleOverride = undefined;
    }
  }

  clearAnonymousOverrideAfterRefresh(epoch);
  syncAnalyticsIdentity();
  if (succeeded) cycle.resolve();
  else cycle.reject(cause);
};

const createRefreshCycle = (epoch: number): RefreshCycle => {
  let resolve: () => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    activeEpoch: epoch,
    promise,
    reject,
    requestedEpoch: epoch,
    resolve,
  };
};

const requestRefresh = (epoch: number): Promise<void> => {
  authorityRefreshPending = true;
  authorityRefreshFailed = false;
  completedRefreshEpoch = undefined;

  if (refreshCycle !== undefined) {
    if (epoch > refreshCycle.requestedEpoch) {
      refreshCycle.requestedEpoch = epoch;
    }
    syncAnalyticsIdentity();
    return refreshCycle.promise;
  }

  const cycle = createRefreshCycle(epoch);
  refreshCycle = cycle;
  syncAnalyticsIdentity();
  startRefresh(cycle, epoch);
  return cycle.promise;
};

const handleSessionSnapshot = () => {
  if (!authorityRefreshPending && completedRefreshEpoch === refreshEpoch) {
    clearPendingOverrideAfterRefresh();
    clearAnonymousOverrideAfterRefresh(refreshEpoch);
  }
  syncAnalyticsIdentity();
};

const markRefreshPending = () => {
  authorityRefreshPending = true;
  authorityRefreshFailed = false;
  syncAnalyticsIdentity();
};

const requestExternalRefresh = () => {
  markRefreshPending();
  if (externalRefreshRequestedThisTurn && refreshCycle !== undefined) return;

  if (!externalRefreshRequestedThisTurn) {
    externalRefreshRequestedThisTurn = true;
    queueMicrotask(() => {
      externalRefreshRequestedThisTurn = false;
    });
  }
  refreshEpoch += 1;
  void requestRefresh(refreshEpoch).catch(() => undefined);
};

const beginRemoteAccountTransition = () => {
  refreshEpoch += 1;
  if (!accountTransitionPending) {
    lifecycleOverride = "pending";
  }
  completedRefreshEpoch = undefined;
  authorityRefreshFailed = false;
  syncAnalyticsIdentity();
  void requestRefresh(refreshEpoch).catch(() => undefined);
};

const installBrowserListeners = () => {
  const browserWindow = globalThis.window;
  const browserDocument = globalThis.document;
  if (browserWindow === undefined || browserDocument === undefined) {
    return;
  }
  if (browserListenersCleanup !== undefined) return;

  const handleVisibilityChange = () => {
    if (browserDocument.visibilityState === "visible") {
      requestExternalRefresh();
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === accountSessionChangeStorageKey) {
      beginRemoteAccountTransition();
    }
  };

  browserWindow.addEventListener("focus", requestExternalRefresh);
  browserWindow.addEventListener("online", requestExternalRefresh);
  browserWindow.addEventListener("storage", handleStorage);
  browserDocument.addEventListener("visibilitychange", handleVisibilityChange);

  browserListenersCleanup = () => {
    browserWindow.removeEventListener("focus", requestExternalRefresh);
    browserWindow.removeEventListener("online", requestExternalRefresh);
    browserWindow.removeEventListener("storage", handleStorage);
    browserDocument.removeEventListener(
      "visibilitychange",
      handleVisibilityChange
    );
    browserListenersCleanup = undefined;
  };
};

const mount = () => {
  authorityRefreshPending = true;
  authorityRefreshFailed = false;
  syncAnalyticsIdentity();
  unsubscribeSession = sessionAtom.subscribe(handleSessionSnapshot);
  installBrowserListeners();
  void requestRefresh(refreshEpoch).catch(() => undefined);
};

const unmount = () => {
  browserListenersCleanup?.();
  unsubscribeSession?.();
  unsubscribeSession = undefined;
  clearExpiryTimer();
};

export function getAnalyticsAccountIdentity(): AnalyticsAccountIdentity {
  syncAnalyticsIdentity();
  return publishedIdentity;
}

export function subscribeAnalyticsAccountIdentity(
  listener: () => void
): () => void {
  const wasEmpty = listeners.length === 0;
  listeners.push(listener);

  if (wasEmpty) {
    const previousIdentity = publishedIdentity;
    mount();
    if (sameIdentity(previousIdentity, publishedIdentity)) listener();
  } else {
    const previousIdentity = publishedIdentity;
    syncAnalyticsIdentity();
    if (sameIdentity(previousIdentity, publishedIdentity)) listener();
  }

  return () => {
    const index = listeners.indexOf(listener);
    if (index === -1) return;
    listeners.splice(index, 1);
    if (listeners.length === 0) unmount();
  };
}

export function refreshAnalyticsAccountIdentity(options?: {
  readonly settleTransition?: true;
}): Promise<void> {
  if (options?.settleTransition === true && accountTransitionPending) {
    accountTransitionPending = false;
    lifecycleOverride = undefined;
  }
  refreshEpoch += 1;
  return requestRefresh(refreshEpoch);
}

export function beginAnalyticsAccountTransition(): void {
  refreshEpoch += 1;
  accountTransitionPending = true;
  lifecycleOverride = "pending";
  completedRefreshEpoch = undefined;
  authorityRefreshFailed = false;
  syncAnalyticsIdentity();
}

export function completeAnalyticsAccountSignOut(): void {
  refreshEpoch += 1;
  accountTransitionPending = false;
  lifecycleOverride = "anonymous";
  completedRefreshEpoch = undefined;
  authorityRefreshPending = false;
  authorityRefreshFailed = false;
  expiryRefreshRequested = false;
  publish(anonymousIdentity, { suppressSessionChangeNotification: true });
  scheduleExpiryTimer(undefined);
  notifyAccountSessionChange();

  void requestRefresh(refreshEpoch).catch(() => undefined);
}
