import type { AnalyticsConsentStatus } from "../consent/analytics-consent";
import type {
  AnalyticsClient,
  AnalyticsProperties,
  CreateAnalyticsClient,
} from "./analytics-client";
import {
  type AnalyticsSettings,
  allowsRemoteFeatureFlags,
} from "./analytics-settings";
import {
  type AnalyticsIdentity,
  type AppliedDistinctId,
  analyticsDistinctId,
  identitySteps,
} from "./identity";

/** An app analytics event, sent once analytics is ready. */
export interface AnalyticsEvent {
  readonly name: string;
  readonly properties?: AnalyticsProperties;
  /**
   * Held until a signed-in identity is applied, so the event is attributed to
   * the account, such as "sign-in completed".
   */
  readonly awaitsAccount?: boolean;
}

type Delivery =
  | { readonly kind: "capture"; readonly event: AnalyticsEvent }
  | { readonly kind: "screen"; readonly name: string };

export interface AnalyticsConsentSource {
  readonly status: () => AnalyticsConsentStatus;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Whether an account's analytics waits for its consent check. */
export interface AccountConsentHold {
  readonly holds: (accountId: string) => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

/** What the app attaches at startup; tests attach fakes. */
export interface AnalyticsRuntime {
  /** `null` when the build has no usable PostHog key and host. */
  readonly settings: AnalyticsSettings | null;
  readonly createClient: CreateAnalyticsClient;
  /** True when another PostHog SDK already runs in this page. */
  readonly detectOtherSdk: () => boolean;
  readonly consent: AnalyticsConsentSource;
  /**
   * Holds the signed-in account's delivery while its consent is checked
   * against the account. Absent where the app doesn't check (the web bundle).
   */
  readonly accountCheck?: AccountConsentHold;
  /**
   * Removes what an earlier client stored (identity, queued events), called
   * only while no client runs. It resolves once the state is gone.
   */
  readonly clearStoredState: () => Promise<void>;
  readonly warn: (message: string) => void;
}

export interface AnalyticsController {
  /** Attaches the runtime. Returns the detach function, which tears down. */
  readonly connect: (runtime: AnalyticsRuntime) => () => void;
  readonly setIdentity: (identity: AnalyticsIdentity) => void;
  readonly capture: (event: AnalyticsEvent) => void;
  readonly screen: (name: string) => void;
  /**
   * A flag's value for the settled identity, or `undefined` while there is no
   * consented client, identity or loaded flags. After the identity changes it
   * stays `undefined` until that identity's flags load.
   */
  readonly featureFlag: (flag: string) => boolean | string | undefined;
  /** Notified when flag values may have changed. */
  readonly subscribeFeatureFlags: (listener: () => void) => () => void;
}

/** Events held while consent is granted but the client or identity is not ready. */
const outboxCapacity = 50;

/**
 * The person property posthog-js `setInternalOrTestUser()` sets, so reports
 * that exclude internal users drop test accounts and non-production builds.
 */
const internalOrTestUser = { $internal_or_test_user: true } as const;

/**
 * Builds the analytics controller. The SDK client is constructed only once
 * analytics consent is granted and the identity has settled, because
 * construction already fetches remote config and flags. Withdrawal shuts the
 * client down and drops it; granting again builds a fresh one. Without a
 * client, a refusal clears what an earlier client stored, such as when the
 * account's withdrawal arrives before any client started.
 *
 * After a withdrawal no client starts until its shutdown or that clearing
 * has succeeded, since a new client would restore the withdrawn identity and
 * queued events. A grant retries a failed clearing first; if that fails too,
 * analytics stays off until the next withdrawal or reconnect.
 *
 * A signed-in identity also waits while the runtime's account check holds
 * it: nothing is identified, captured or flushed for the account until the
 * check releases it, so a withdrawal the check applies discards it all.
 */
export const createAnalytics = (): AnalyticsController => {
  let runtime: AnalyticsRuntime | undefined;
  let detachConsent: (() => void) | undefined;
  let detachAccountCheck: (() => void) | undefined;
  let identity: AnalyticsIdentity = { kind: "pending" };
  let client: AnalyticsClient | undefined;
  let detachClientFlags: (() => void) | undefined;
  let applied: AppliedDistinctId = null;
  let blockedByOtherSdk = false;
  /** The SDK failed to start; no retry until the runtime reconnects. */
  let startFailed = false;
  /** A client built but still loading its stored state. */
  let starting: AnalyticsClient | undefined;
  /** The client was just adopted and has not had an identity applied yet. */
  let adopting = false;
  let shutdownInProgress: Promise<void> | undefined;
  /** Stored SDK state being removed; no client starts meanwhile. */
  let clearing: Promise<void> | undefined;
  /**
   * What the SDK's storage may hold: `withdrawn` once a refusal finds state
   * there, which keeps every client from starting until it is removed.
   */
  let storedState: "present" | "withdrawn" | "cleared" = "present";
  /**
   * Bumped each time consent turns granted or not, so each grant and each
   * refusal gets one attempt at clearing.
   */
  let consentPeriod = 0;
  let periodGranted: boolean | undefined;
  /** The consent period in which clearing failed; no retry within it. */
  let clearFailedPeriod: number | undefined;
  /** Whether the account's delivery was held at the last reconcile. */
  let accountHeld = false;
  let outbox: Delivery[] = [];
  let heldForAccount: AnalyticsEvent[] = [];
  /**
   * Whether the client's flag values belong to the applied identity. The SDK
   * keeps the previous identity's flags readable after identify() or
   * reset(), a response it requested earlier still notifies, and a restarted
   * client may restore them, so only a reload the controller started for the
   * applied identity makes them current.
   */
  let flagsCurrent = false;
  /** Bumped on each identity change, so an older reload cannot vouch for flags. */
  let flagGeneration = 0;
  const flagListeners = new Set<() => void>();

  const notifyFlags = () => {
    for (const listener of flagListeners) listener();
  };

  const consentStatus = (): AnalyticsConsentStatus =>
    runtime?.consent.status() ?? "loading";

  const consentGranted = () => consentStatus() === "granted";

  // Events wait in memory while consent is granted or not yet known; nothing
  // is sent before a granted consent, and an undecided or denied answer
  // discards them.
  const canDeliverLater = () => {
    const status = consentStatus();
    if (status !== "granted" && status !== "loading") return false;
    return (
      runtime === undefined ||
      (runtime.settings !== null &&
        !blockedByOtherSdk &&
        !startFailed &&
        !clearFailed())
    );
  };

  const clearFailed = () => clearFailedPeriod === consentPeriod;

  const holdsAccount = () =>
    identity.kind === "authenticated" &&
    runtime?.accountCheck?.holds(identity.accountId) === true;

  /** Whether delivery may go to the identity: settled and not held. */
  const identityReady = () => identity.kind !== "pending" && !holdsAccount();

  const ready = () => client !== undefined && identityReady();

  // While the account is held, flags stay readable only for a client already
  // identified as that account (as after returning to the foreground), whose
  // network the hold pauses.
  const flagsReadable = () =>
    client !== undefined &&
    identity.kind !== "pending" &&
    flagsCurrent &&
    (!holdsAccount() ||
      (identity.kind === "authenticated" &&
        applied === analyticsDistinctId(identity.accountId)));

  const deliver = (target: AnalyticsClient, delivery: Delivery) => {
    if (delivery.kind === "screen") {
      target.screen(delivery.name);
      return;
    }
    if (delivery.event.awaitsAccount && applied === null) {
      heldForAccount = [...heldForAccount, delivery.event].slice(
        -outboxCapacity
      );
      return;
    }
    target.capture(delivery.event.name, delivery.event.properties);
  };

  const enqueue = (delivery: Delivery) => {
    if (!canDeliverLater()) return;
    if (client !== undefined && ready()) {
      deliver(client, delivery);
    } else if (outbox.length < outboxCapacity) {
      outbox = [...outbox, delivery];
    }
  };

  const discardPending = () => {
    outbox = [];
    heldForAccount = [];
  };

  const retire = (closing: AnalyticsClient) => {
    const shutdown = closing
      .shutDown()
      .then(
        () => {
          // Shutdown clears the client's stored state.
          storedState = "cleared";
        },
        (error: unknown) => {
          runtime?.warn(`Analytics shutdown failed: ${String(error)}`);
        }
      )
      .finally(() => {
        if (shutdownInProgress === shutdown) shutdownInProgress = undefined;
        reconcile();
      });
    shutdownInProgress = shutdown;
  };

  const clearStoredState = (owner: AnalyticsRuntime) => {
    if (
      storedState !== "withdrawn" ||
      clearFailed() ||
      client !== undefined ||
      starting !== undefined ||
      shutdownInProgress !== undefined ||
      clearing !== undefined
    ) {
      return;
    }
    const period = consentPeriod;
    const cleared = owner
      .clearStoredState()
      .then(
        () => {
          storedState = "cleared";
        },
        (error: unknown) => {
          owner.warn(
            `Clearing stored analytics state failed: ${String(error)}`
          );
          // A grant that arrived meanwhile still gets its own attempt.
          if (period !== consentPeriod) return;
          clearFailedPeriod = period;
          // This grant's analytics stays off.
          if (consentGranted()) discardPending();
        }
      )
      .finally(() => {
        if (clearing === cleared) clearing = undefined;
        reconcile();
      });
    clearing = cleared;
  };

  const shutDownClient = () => {
    if (starting !== undefined) {
      const abandoned = starting;
      starting = undefined;
      retire(abandoned);
    }
    const closing = client;
    if (closing === undefined) return;
    detachClientFlags?.();
    detachClientFlags = undefined;
    client = undefined;
    applied = null;
    flagsCurrent = false;
    flagGeneration++;
    retire(closing);
    notifyFlags();
  };

  const loadFlagsForAppliedIdentity = (target: AnalyticsClient) => {
    const generation = ++flagGeneration;
    target.reloadFeatureFlags().then(
      () => {
        if (client !== target || generation !== flagGeneration) return;
        flagsCurrent = true;
        notifyFlags();
      },
      (error: unknown) => {
        if (client !== target || generation !== flagGeneration) return;
        runtime?.warn(`Feature flags failed to load: ${String(error)}`);
      }
    );
  };

  const applyIdentity = (target: AnalyticsClient) => {
    if (identity.kind === "pending") return;
    const steps = identitySteps(applied, identity);
    for (const step of steps) {
      if (step.kind === "reset") {
        target.reset();
        applied = null;
      } else {
        target.identify(step.distinctId);
        applied = step.distinctId;
      }
    }
    if (identity.kind === "authenticated" && (steps.length > 0 || adopting)) {
      const markInternal =
        identity.testAccount || runtime?.settings?.environment !== "production";
      if (markInternal) target.setPersonProperties(internalOrTestUser);
    }
    // A new client's stored flags may not match its stored identity, since
    // identify() persists the new ID before the new flags arrive, so it waits
    // for its own load too. Outside production flags never load, so flag
    // reads keep their fallback.
    const loadsFlags =
      runtime?.settings != null &&
      allowsRemoteFeatureFlags(runtime.settings.environment);
    if (loadsFlags && (steps.length > 0 || adopting)) {
      flagsCurrent = false;
      loadFlagsForAppliedIdentity(target);
    }
    adopting = false;
  };

  const flush = (target: AnalyticsClient) => {
    const pending = outbox;
    outbox = [];
    for (const delivery of pending) deliver(target, delivery);
    if (applied !== null && heldForAccount.length > 0) {
      const held = heldForAccount;
      heldForAccount = [];
      for (const event of held) target.capture(event.name, event.properties);
    }
  };

  const reconcile = () => {
    if (runtime === undefined || consentStatus() === "loading") return;
    if (consentGranted() !== periodGranted) {
      periodGranted = consentGranted();
      consentPeriod++;
    }
    if (!consentGranted()) {
      discardPending();
      // An undecided device never ran a client.
      if (consentStatus() === "denied" && storedState === "present") {
        storedState = "withdrawn";
      }
      shutDownClient();
      clearStoredState(runtime);
      return;
    }
    const held = holdsAccount();
    // Pauses the SDK's own sending too: events it queued earlier and its
    // flushes on app-state changes wait for the check.
    client?.holdNetwork(held);
    if (held !== accountHeld) {
      accountHeld = held;
      notifyFlags();
    }
    const settings = runtime.settings;
    if (
      settings === null ||
      blockedByOtherSdk ||
      startFailed ||
      clearFailed()
    ) {
      return;
    }
    if (
      !identityReady() ||
      shutdownInProgress !== undefined ||
      starting !== undefined ||
      clearing !== undefined
    ) {
      return;
    }
    if (client === undefined) {
      if (storedState === "withdrawn") {
        clearStoredState(runtime);
        return;
      }
      if (runtime.detectOtherSdk()) {
        blockedByOtherSdk = true;
        discardPending();
        runtime.warn(
          "Another PostHog SDK is already running in this page; app analytics stays off."
        );
        return;
      }
      construct(runtime, settings);
      return;
    }
    applyIdentity(client);
    flush(client);
    notifyFlags();
  };

  const construct = (owner: AnalyticsRuntime, settings: AnalyticsSettings) => {
    storedState = "present";
    const created = owner.createClient({
      apiKey: settings.apiKey,
      host: settings.host,
      remoteFeatureFlags: allowsRemoteFeatureFlags(settings.environment),
      superProperties: {
        "deployment.environment.name": settings.environment,
      },
    });
    // Reachable while it loads, so a withdrawal can retire it at once.
    starting = created;
    created.ready().then(
      () => {
        // Withdrawn or disconnected meanwhile: it was already retired.
        if (starting !== created) return;
        starting = undefined;
        client = created;
        applied = created.identifiedAs();
        adopting = true;
        detachClientFlags = created.onFeatureFlags(notifyFlags);
        reconcile();
      },
      (error: unknown) => {
        if (starting !== created) return;
        starting = undefined;
        startFailed = true;
        discardPending();
        owner.warn(`Analytics failed to start: ${String(error)}`);
        retire(created);
      }
    );
  };

  return {
    connect: (next) => {
      detachConsent?.();
      detachAccountCheck?.();
      runtime = next;
      blockedByOtherSdk = false;
      startFailed = false;
      clearFailedPeriod = undefined;
      detachConsent = next.consent.subscribe(reconcile);
      detachAccountCheck = next.accountCheck?.subscribe(reconcile);
      reconcile();
      return () => {
        if (runtime !== next) return;
        detachConsent?.();
        detachConsent = undefined;
        detachAccountCheck?.();
        detachAccountCheck = undefined;
        discardPending();
        shutDownClient();
        runtime = undefined;
      };
    },
    setIdentity: (next) => {
      identity = next;
      reconcile();
      if (next.kind === "pending") notifyFlags();
    },
    capture: (event) => enqueue({ kind: "capture", event }),
    screen: (name) => enqueue({ kind: "screen", name }),
    featureFlag: (flag) =>
      client !== undefined && flagsReadable()
        ? client.getFeatureFlag(flag)
        : undefined,
    subscribeFeatureFlags: (listener) => {
      flagListeners.add(listener);
      return () => {
        flagListeners.delete(listener);
      };
    },
  };
};

/** The app's one analytics controller; `AnalyticsRoot` connects it. */
export const analytics = createAnalytics();

/**
 * Settles who analytics attributes events to. The account sign-in flow calls
 * this; until it exists the root layout settles an anonymous identity.
 */
export const setAnalyticsIdentity = (identity: AnalyticsIdentity): void =>
  analytics.setIdentity(identity);
