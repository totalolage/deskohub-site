import type { AnalyticsConsentStatus } from "../consent/analytics-consent";
import type {
  AnalyticsClient,
  AnalyticsProperties,
  CreateAnalyticsClient,
} from "./analytics-client";
import type { AnalyticsSettings } from "./analytics-settings";
import {
  type AnalyticsIdentity,
  type AppliedDistinctId,
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

/** What the app attaches at startup; tests attach fakes. */
export interface AnalyticsRuntime {
  /** `null` when the build has no usable PostHog key and host. */
  readonly settings: AnalyticsSettings | null;
  readonly createClient: CreateAnalyticsClient;
  /** True when another PostHog SDK already runs in this page. */
  readonly detectOtherSdk: () => boolean;
  readonly consent: AnalyticsConsentSource;
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
 * client down and drops it; granting again builds a fresh one.
 */
export const createAnalytics = (): AnalyticsController => {
  let runtime: AnalyticsRuntime | undefined;
  let detachConsent: (() => void) | undefined;
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
      (runtime.settings !== null && !blockedByOtherSdk && !startFailed)
    );
  };

  const ready = () => client !== undefined && identity.kind !== "pending";

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
      .catch((error: unknown) => {
        runtime?.warn(`Analytics shutdown failed: ${String(error)}`);
      })
      .finally(() => {
        if (shutdownInProgress === shutdown) shutdownInProgress = undefined;
        reconcile();
      });
    shutdownInProgress = shutdown;
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
    // for its own load too.
    if (steps.length > 0 || adopting) {
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
    if (!consentGranted()) {
      discardPending();
      shutDownClient();
      return;
    }
    const settings = runtime.settings;
    if (settings === null || blockedByOtherSdk || startFailed) return;
    if (
      identity.kind === "pending" ||
      shutdownInProgress !== undefined ||
      starting !== undefined
    ) {
      return;
    }
    if (client === undefined) {
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
    const created = owner.createClient({
      apiKey: settings.apiKey,
      host: settings.host,
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
      runtime = next;
      blockedByOtherSdk = false;
      startFailed = false;
      detachConsent = next.consent.subscribe(reconcile);
      reconcile();
      return () => {
        if (runtime !== next) return;
        detachConsent?.();
        detachConsent = undefined;
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
      client !== undefined && identity.kind !== "pending" && flagsCurrent
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
