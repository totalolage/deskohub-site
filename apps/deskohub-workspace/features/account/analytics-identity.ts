"use client";

import { isTestEmailAddress } from "@deskohub/test-email";
import { Option, Predicate, Schema } from "effect";
import { runWorkspaceBrowserEffect } from "@/shared/browser/workspace-browser-effect";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import { authClient } from "./auth.client";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "./customer-account";

export type AnalyticsAccountIdentity =
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "anonymous" }
  | {
      status: "authenticated";
      accountId: CustomerAccountId;
      /** The verified login email is on the reserved test domain. */
      testAccount: boolean;
    };

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
        email: Schema.optionalKey(Schema.Unknown),
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
type SignedInSessionData = NonNullable<ParsedSessionSnapshot["data"]>;
type SignedInUser = NonNullable<SignedInSessionData["user"]>;

type IdentityFacts = {
  readonly expiresAt?: number;
  readonly identity: AnalyticsAccountIdentity;
};

type LifecycleOverride = "pending" | "anonymous";

type SettledIdentity = Extract<
  AnalyticsAccountIdentity,
  { readonly status: "anonymous" | "authenticated" }
>;

type PublishOptions = {
  readonly suppressSessionChangeNotification?: boolean;
};

type RefreshCycle = {
  /** Settles once the cycle finishes, whether the refresh succeeded or not. */
  readonly promise: Promise<void>;
  readonly settle: () => void;
  activeEpoch: number;
  requestedEpoch: number;
};

const sessionAtom = authClient.useSession;
const authoritativeRefreshOptions: SessionRefetchOptions = {
  query: { disableCookieCache: true },
};
const accountSessionChangeStorageKey = "deskohub.account-session-change";
const sessionRefreshFailureCode = "account.analytics-session.refresh-failed";

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

const authenticatedIdentityOf = (
  user: SignedInUser
): AnalyticsAccountIdentity | undefined => {
  const accountId = Option.getOrUndefined(
    Schema.decodeUnknownOption(customerAccountIdSchema)(user.id)
  );
  if (accountId === undefined) return undefined;

  return {
    accountId,
    status: "authenticated",
    testAccount:
      Predicate.isString(user.email) && isTestEmailAddress(user.email),
  };
};

/** Only a verified, nonexpired session with a valid account ID identifies. */
const readSignedInIdentity = (data: SignedInSessionData): IdentityFacts => {
  const { session, user } = data;
  if (user === null || session === null || user.emailVerified !== true) {
    return { identity: unavailableIdentity };
  }

  const expiresAtMillis = session.expiresAt.getTime();
  if (!Number.isFinite(expiresAtMillis)) {
    return { identity: unavailableIdentity };
  }
  if (expiresAtMillis <= Date.now()) {
    return { expiresAt: expiresAtMillis, identity: unavailableIdentity };
  }

  const identity = authenticatedIdentityOf(user);
  return identity === undefined
    ? { identity: unavailableIdentity }
    : { expiresAt: expiresAtMillis, identity };
};

const readSessionIdentity = (value: SessionAtomSnapshot): IdentityFacts => {
  const flags = parseSessionFlags(value);
  if (flags === undefined) return { identity: unavailableIdentity };
  if (flags.isPending || flags.isRefetching) {
    return { identity: pendingIdentity };
  }

  const snapshot = parseSessionSnapshot(value);
  if (snapshot === undefined || snapshot.error !== null) {
    return { identity: unavailableIdentity };
  }
  if (snapshot.data === null) return { identity: anonymousIdentity };

  return readSignedInIdentity(snapshot.data);
};

const readCurrentSession = (): SessionAtomSnapshot => sessionAtom.get();

const clearExpiryTimer = () => {
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  expiryTimer = undefined;
  expiryAt = undefined;
};

const maximumTimerDelay = 2_147_483_647;

const armExpiryTimer = (expiresAt: number, delay: number) => {
  expiryRefreshRequested = false;
  if (expiryTimer !== undefined && expiryAt === expiresAt) return;

  clearExpiryTimer();
  expiryAt = expiresAt;
  expiryTimer = setTimeout(
    () => {
      expiryTimer = undefined;
      expiryAt = undefined;
      expiryRefreshRequested = true;
      requestExternalRefresh();
    },
    Math.min(delay, maximumTimerDelay)
  );
};

/** Requests one refresh per expiry until a fresh expiry arrives. */
const refreshExpiredSession = (expiresAt: number) => {
  clearExpiryTimer();
  if (expiryRefreshRequested) return;

  expiryAt = expiresAt;
  expiryRefreshRequested = true;
  requestExternalRefresh();
};

const scheduleExpiryTimer = (expiresAt: number | undefined) => {
  if (listeners.length === 0 || expiresAt === undefined) {
    clearExpiryTimer();
    return;
  }

  const delay = expiresAt - Date.now();
  if (delay > 0) armExpiryTimer(expiresAt, delay);
  else refreshExpiredSession(expiresAt);
};

// Storage is an optimization for other tabs, not the local state path, so a
// throwing storage write is ignored.
const writeAccountSessionChangeMarker = Option.liftThrowable(
  (browserWindow: Window) =>
    browserWindow.localStorage.setItem(
      accountSessionChangeStorageKey,
      crypto.randomUUID()
    )
);

const notifyAccountSessionChange = () => {
  const browserWindow = globalThis.window;
  if (browserWindow === undefined) return;

  writeAccountSessionChangeMarker(browserWindow);
};

/** Records a settled identity and reports whether it changed. */
const recordSettledIdentity = (identity: AnalyticsAccountIdentity): boolean => {
  const settledIdentity = settledIdentityOf(identity);
  if (settledIdentity === undefined) return false;

  const changed =
    lastSettledIdentity === undefined ||
    !sameIdentity(lastSettledIdentity, settledIdentity);
  lastSettledIdentity = settledIdentity;
  return changed;
};

const publish = (
  identity: AnalyticsAccountIdentity,
  options: PublishOptions = {}
) => {
  const settledIdentityChanged = recordSettledIdentity(identity);

  if (!sameIdentity(publishedIdentity, identity)) {
    publishedIdentity = identity;
    for (const listener of [...listeners]) listener();
  }

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
    try {
      const snapshot = readCurrentSession();
      await snapshot.refetch(authoritativeRefreshOptions);
      succeeded = true;
      // better-auth resolves the refetch even when the request fails and
      // records the failure on the atom, which publishes `unavailable`.
      const refreshError = readCurrentSession().error;
      if (Predicate.isNotNullish(refreshError)) {
        logSessionRefreshFailure(refreshError);
      }
    } catch (failure) {
      logSessionRefreshFailure(failure);
    } finally {
      finishRefresh(cycle, epoch, succeeded);
    }
  })();
  syncAnalyticsIdentity();
};

// Logs each failed refetch once, whether it rejects or resolves with an error
// on the atom, including one a newer refresh supersedes.
// The log never settles or delays the refresh cycle.
const logSessionRefreshFailure = (cause: unknown) => {
  void reportWorkspaceBrowserFailure(sessionRefreshFailureCode, cause).pipe(
    runWorkspaceBrowserEffect("account.analytics-identity.refresh")
  );
};

const finishRefresh = (
  cycle: RefreshCycle,
  epoch: number,
  succeeded: boolean
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
  cycle.settle();
};

const createRefreshCycle = (epoch: number): RefreshCycle => {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    settle = resolvePromise;
  });
  return {
    activeEpoch: epoch,
    promise,
    requestedEpoch: epoch,
    settle,
  };
};

const requestRefresh = (epoch: number): RefreshCycle => {
  authorityRefreshPending = true;
  authorityRefreshFailed = false;
  completedRefreshEpoch = undefined;

  if (refreshCycle !== undefined) {
    if (epoch > refreshCycle.requestedEpoch) {
      refreshCycle.requestedEpoch = epoch;
    }
    syncAnalyticsIdentity();
    return refreshCycle;
  }

  const cycle = createRefreshCycle(epoch);
  refreshCycle = cycle;
  syncAnalyticsIdentity();
  startRefresh(cycle, epoch);
  return cycle;
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
  requestRefresh(refreshEpoch);
};

const beginRemoteAccountTransition = () => {
  refreshEpoch += 1;
  if (!accountTransitionPending) {
    lifecycleOverride = "pending";
  }
  completedRefreshEpoch = undefined;
  authorityRefreshFailed = false;
  syncAnalyticsIdentity();
  requestRefresh(refreshEpoch);
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
  requestRefresh(refreshEpoch);
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

/**
 * Refreshes the identity from the authoritative session. The promise resolves
 * once the refresh settles and never rejects: a failed refresh publishes the
 * unavailable identity and reports `account.analytics-session.refresh-failed`
 * itself, so callers neither catch nor report it.
 */
export function refreshAnalyticsAccountIdentity(options?: {
  readonly settleTransition?: true;
}): Promise<void> {
  if (options?.settleTransition === true && accountTransitionPending) {
    accountTransitionPending = false;
    lifecycleOverride = undefined;
  }
  refreshEpoch += 1;
  return requestRefresh(refreshEpoch).promise;
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

  requestRefresh(refreshEpoch);
}
