import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import type { PostHogClientSource } from "@deskohub/posthog/feature-flags/react";
import type { BeforeSendFn, PostHog } from "posthog-js";
import {
  getAnalyticsDotyposCustomerId,
  requestAnalyticsDotyposCustomerId,
  subscribeAnalyticsDotyposCustomerId,
} from "@/features/account/analytics-customer-link";
import {
  type AnalyticsAccountIdentity,
  getAnalyticsAccountIdentity,
  refreshAnalyticsAccountIdentity,
  subscribeAnalyticsAccountIdentity,
} from "@/features/account/analytics-identity";
import { captureRecordedSignInCompletion } from "@/features/account/sign-in-analytics";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";
import { applyFeatureFlagOverrides } from "@/features/feature-flags/react";
import {
  deliverWorkspaceBrowserLogs,
  discardWorkspaceBrowserLogs,
  type WorkspaceBrowserLogRecord,
} from "@/shared/browser/workspace-browser-logs";
import {
  byStage,
  type DeploymentEnvironment,
} from "@/shared/deployment/deployment-stage";
import {
  createPostHogSessionClearCookieStrings,
  createPostHogSessionCookieStrings,
  writePostHogSessionCookie,
} from "@/shared/utils/posthog-session-cookies";
import { createPreloadableModule } from "@/shared/utils/preloadable-module";
import {
  deliverAnalyticsEvents,
  discardAnalyticsEvents,
} from "./analytics-events";
import {
  createPostHogConfig,
  isPostHogTelemetryHostAllowed,
} from "./utils/posthog-config";
import { preparePostHogEvent } from "./utils/posthog-event";
import {
  createPostHogIdentityController,
  isSettledAnalyticsAccountIdentity,
  type PostHogIdentityController,
  type SettledAnalyticsAccountIdentity,
  sameSettledAnalyticsAccountIdentity,
} from "./utils/posthog-identity";
import { loadPostHogSdk } from "./utils/posthog-sdk-load";
import { createPostHogPageUrl } from "./utils/posthog-url";
import { type VisitorConsentChange, visitorConsent } from "./visitor-consent";

/** What the page tells the analytics session on every render. */
export type BrowserAnalyticsSettings = {
  /**
   * The page's view of analytics consent, false until consent hydrates. The
   * consent cookie must also accept analytics at every use.
   */
  readonly analyticsAccepted: boolean;
  readonly featureFlagOverrides?:
    | PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>
    | undefined;
  readonly pathname: string | null;
  readonly posthogEnvironment: DeploymentEnvironment;
  readonly posthogHost: string | undefined;
  readonly posthogProjectToken: string;
};

/**
 * The page's one PostHog lifecycle: it loads and initializes the SDK only
 * with analytics consent and a safe telemetry host, keeps the SDK identity on
 * the account identity, captures pageviews, mirrors the session cookies, and
 * delivers held analytics events and browser logs while analytics is ready.
 */
export type BrowserAnalyticsSession = {
  /** The SDK as the feature-flag hooks read it, once it has loaded. */
  readonly featureFlagClient: PostHogClientSource;
  /**
   * Follows account identity and consent changes until the returned
   * disconnect, which pauses analytics without resetting the identity.
   */
  readonly connect: () => () => void;
  /** Applies the page's latest settings; unchanged settings do nothing. */
  readonly sync: (settings: BrowserAnalyticsSettings) => void;
};

const pendingIdentity: AnalyticsAccountIdentity = { status: "pending" };

const telemetryHostAllowedFor = (posthogHost: string | undefined) => {
  const applicationHostname = globalThis.window?.location.hostname;
  return (
    posthogHost !== undefined &&
    applicationHostname !== undefined &&
    isPostHogTelemetryHostAllowed(posthogHost, applicationHostname)
  );
};

const clearPostHogInitialPersonProperties = (posthog: PostHog) => {
  // These are the posthog-js 1.418.1 persistence keys. Re-audit the keys when
  // upgrading the SDK; save_referrer/save_campaign_params do not clear old data.
  posthog.unregister("$initial_person_info");
  posthog.unregister("$initial_referrer_info");
  posthog.unregister("$initial_campaign_params");
};

const clearPostHogSessionCookies = () => {
  for (const cookie of createPostHogSessionClearCookieStrings()) {
    writePostHogSessionCookie(cookie);
  }
};

// Browser logs wait for the same consented, settled identity as events: a
// record logged while analytics is paused is delivered once it resumes.
const createWorkspaceBrowserLogSink =
  (posthog: PostHog, posthogEnvironment: string) =>
  ({ attributes, body, level }: WorkspaceBrowserLogRecord) => {
    posthog.captureLog({
      attributes: {
        ...attributes,
        "deployment.environment.name": posthogEnvironment,
        "url.full": createPostHogPageUrl(window.location.href),
      },
      body,
      level,
    });
  };

/** Whether a settings change must restart or reload the SDK. */
const changesSdkStart = (
  previous: BrowserAnalyticsSettings | undefined,
  next: BrowserAnalyticsSettings
) =>
  previous === undefined ||
  previous.analyticsAccepted !== next.analyticsAccepted ||
  previous.featureFlagOverrides !== next.featureFlagOverrides ||
  previous.posthogEnvironment !== next.posthogEnvironment ||
  previous.posthogHost !== next.posthogHost ||
  previous.posthogProjectToken !== next.posthogProjectToken;

/**
 * Creates the page's analytics session. The `posthog-js` SDK stays private to
 * it: the SDK chunk loads only once analytics consent lets it initialize.
 */
export function createBrowserAnalyticsSession(): BrowserAnalyticsSession {
  const sdkModule = createPreloadableModule(() => import("posthog-js"));

  let settings: BrowserAnalyticsSettings | undefined;
  let connected = false;
  let cancelSdkLoad: (() => void) | undefined;
  let consentSignal = false;
  let telemetryHostAllowed = false;
  // The identity the controller reconciles to; pending while disconnected.
  let accountIdentity: AnalyticsAccountIdentity = pendingIdentity;
  let posthog: PostHog | undefined;
  let identityController: PostHogIdentityController | undefined;
  let browserLogSink: ((record: WorkspaceBrowserLogRecord) => void) | undefined;
  let stopSessionIdSubscription: (() => void) | undefined;
  let detachAnalyticsEvents: (() => void) | undefined;
  let detachBrowserLogs: (() => void) | undefined;
  let lastCapturedPageviewPath: string | undefined;
  let lastReadyIdentity: SettledAnalyticsAccountIdentity | undefined;
  let lastSettledIdentity: SettledAnalyticsAccountIdentity | undefined;
  let hasReadyConsent = false;

  const currentConsent = () =>
    consentSignal && visitorConsent.accepts("analytics");

  const isReadyFor = (identity: AnalyticsAccountIdentity) =>
    telemetryHostAllowed &&
    currentConsent() &&
    identityController?.isReadyFor(identity) === true;

  const isReady = () => isReadyFor(getAnalyticsAccountIdentity());

  const isEventAllowed = (event: NonNullable<Parameters<BeforeSendFn>[0]>) => {
    const identity = getAnalyticsAccountIdentity();
    if (!isReadyFor(identity)) return false;
    if (event.properties.distinct_id !== posthog?.get_distinct_id()) {
      return false;
    }
    return event.event !== "$identify" || identity.status === "authenticated";
  };

  const syncSessionCookies = (sessionId = posthog?.get_session_id()) => {
    if (!posthog || sessionId === undefined || !isReady()) return;

    for (const cookie of createPostHogSessionCookieStrings({
      distinctId: posthog.get_distinct_id(),
      sessionId,
    })) {
      writePostHogSessionCookie(cookie);
    }
  };

  const capturePageviewIfNeeded = (pathname = settings?.pathname ?? null) => {
    if (!isReady()) return;

    const pageviewPath = pathname ?? window.location.pathname;
    if (!pageviewPath || lastCapturedPageviewPath === pageviewPath) return;

    lastCapturedPageviewPath = pageviewPath;
    posthog?.capture("$pageview", {
      $current_url: createPostHogPageUrl(window.location.href),
    });
  };

  const reconcile = (consented = currentConsent()) => {
    // Events and browser logs held while analytics is paused never outlive
    // its consent. The cookie decides: the consent signal reads as withdrawn
    // until the consent state hydrates.
    if (!telemetryHostAllowed || !visitorConsent.accepts("analytics")) {
      discardAnalyticsEvents();
      discardWorkspaceBrowserLogs();
    }

    if (!identityController) {
      if (!telemetryHostAllowed || !consented) clearPostHogSessionCookies();
      return;
    }

    identityController.reconcile(
      telemetryHostAllowed && consented,
      accountIdentity
    );
  };

  // Leaving an account resets the SDK identity, so events held from the
  // account's session, including those held before the SDK loaded, must not
  // follow the visitor to the next identity.
  const discardEventsAfterLeavingAccount = (
    identity: AnalyticsAccountIdentity
  ) => {
    if (!isSettledAnalyticsAccountIdentity(identity)) return;

    if (
      lastSettledIdentity?.status === "authenticated" &&
      !sameSettledAnalyticsAccountIdentity(lastSettledIdentity, identity)
    ) {
      discardAnalyticsEvents();
    }
    lastSettledIdentity = identity;
  };

  const handlePause = () => {
    detachAnalyticsEvents?.();
    detachAnalyticsEvents = undefined;
    detachBrowserLogs?.();
    detachBrowserLogs = undefined;

    if (!(telemetryHostAllowed && currentConsent())) {
      lastCapturedPageviewPath = undefined;
      lastReadyIdentity = undefined;
      hasReadyConsent = false;
    }

    posthog?.set_config({
      advanced_disable_feature_flags: true,
      tracing_headers: [],
    });
    posthog?.stopSessionRecording();
    clearPostHogSessionCookies();
  };

  /** A new identity or a renewed consent captures the current page again. */
  const recordReadyIdentity = (identity: SettledAnalyticsAccountIdentity) => {
    if (
      !hasReadyConsent ||
      !lastReadyIdentity ||
      !sameSettledAnalyticsAccountIdentity(lastReadyIdentity, identity)
    ) {
      lastCapturedPageviewPath = undefined;
    }
    lastReadyIdentity = identity;
    hasReadyConsent = true;
  };

  // Previews, E2E runs and local development share production's PostHog
  // project and its flag-request quota, so, as on the server, only production
  // evaluates flags remotely. Elsewhere the SDK keeps flags disabled and makes
  // no `/flags` request; overrides still apply locally.
  const evaluatesFlagsRemotely = () =>
    settings !== undefined &&
    byStage(settings.posthogEnvironment, {
      otherwise: false,
      production: true,
    });

  const resumeDelivery = (
    client: PostHog,
    identity: SettledAnalyticsAccountIdentity
  ) => {
    const remoteFlags = evaluatesFlagsRemotely();
    client.set_config({
      advanced_disable_feature_flags: !remoteFlags,
      tracing_headers: [window.location.hostname],
    });
    if (remoteFlags) client.reloadFeatureFlags();
    capturePageviewIfNeeded();
    // Events captured while analytics was loading or paused follow the pageview.
    detachAnalyticsEvents ??= deliverAnalyticsEvents(
      ({ event, properties }) => {
        client.capture(event, properties);
      }
    );
    if (identity.status === "authenticated") {
      // A sign-in recorded before this page load lands on the settled account.
      captureRecordedSignInCompletion();
      requestAnalyticsDotyposCustomerId(identity.accountId);
    }
    if (browserLogSink) {
      detachBrowserLogs ??= deliverWorkspaceBrowserLogs(browserLogSink);
    }
  };

  const handleReady = () => {
    const client = posthog;
    if (!client) return;

    const identity = getAnalyticsAccountIdentity();
    if (
      !(isSettledAnalyticsAccountIdentity(identity) && isReadyFor(identity))
    ) {
      return;
    }

    recordReadyIdentity(identity);
    syncSessionCookies();
    clearPostHogInitialPersonProperties(client);
    resumeDelivery(client, identity);
  };

  const initialize = (
    sdk: PostHog,
    {
      posthogEnvironment,
      posthogHost,
      posthogProjectToken,
    }: BrowserAnalyticsSettings & { readonly posthogHost: string }
  ): PostHog | undefined => {
    if (posthog) return posthog;
    // Consent or the telemetry host can change while the SDK loads.
    if (!telemetryHostAllowed || !currentConsent()) return;

    sdk.init(
      posthogProjectToken,
      createPostHogConfig({
        apiHost: posthogHost,
        beforeSend: (event) => {
          if (!event) return event;
          if (!isEventAllowed(event)) return null;

          return preparePostHogEvent(event, posthogEnvironment);
        },
        optOutUseragentFilter: process.env.NODE_ENV === "development",
      })
    );
    clearPostHogInitialPersonProperties(sdk);
    posthog = sdk;
    browserLogSink = createWorkspaceBrowserLogSink(sdk, posthogEnvironment);
    sdk.stopSessionRecording();
    identityController = createPostHogIdentityController(sdk, {
      deploymentEnvironment: posthogEnvironment,
      onPause: handlePause,
      onReady: handleReady,
      readDotyposCustomerId: getAnalyticsDotyposCustomerId,
    });
    return sdk;
  };

  /**
   * Settles an SDK start without analytics consent. Returns true when the SDK
   * must not load or start.
   */
  const settleWithoutConsent = (analyticsAccepted: boolean) => {
    if (!analyticsAccepted && !posthog) {
      clearPostHogSessionCookies();
      return true;
    }
    if (currentConsent()) return false;

    reconcile();
    if (!posthog) clearPostHogSessionCookies();
    return true;
  };

  /** Starts the loaded SDK, or loads it first, for the current settings. */
  const startSdk = () => {
    cancelSdkLoad?.();
    cancelSdkLoad = undefined;
    const current = settings;
    if (!current || settleWithoutConsent(current.analyticsAccepted)) return;

    const { posthogHost } = current;
    if (!telemetryHostAllowed || !posthogHost) return;

    const start = (client: PostHog) => {
      stopSessionIdSubscription ??= client.onSessionId((sessionId) => {
        syncSessionCookies(sessionId);
      });
      applyFeatureFlagOverrides(client, current.featureFlagOverrides);
      reconcile();
    };

    if (posthog) {
      start(posthog);
      return;
    }

    cancelSdkLoad = loadPostHogSdk({
      load: sdkModule.load,
      onLoad: ({ default: sdk }) => {
        const client = initialize(sdk, { ...current, posthogHost });
        if (client) start(client);
      },
      retry: startSdk,
    });
  };

  const pauseForUnsafeTelemetryHost = () => {
    discardAnalyticsEvents();
    identityController?.reconcile(false, accountIdentity);
    clearPostHogSessionCookies();
  };

  const syncConsent = (change: VisitorConsentChange) => {
    const wasConsented = currentConsent();
    const consented = visitorConsent.accepts("analytics");
    consentSignal = consented;

    // A consent given here, in the banner or the account's preference, or
    // newly given in another tab, re-verifies the account before
    // identifying; a focus check only reconciles.
    if (
      consented &&
      (change === "local" ||
        change === "preference" ||
        (change === "other-tab" && !wasConsented))
    ) {
      void refreshAnalyticsAccountIdentity();
    }

    reconcile(consented);
  };

  const syncAccountIdentity = () => {
    accountIdentity = getAnalyticsAccountIdentity();
    discardEventsAfterLeavingAccount(accountIdentity);
    reconcile();
  };

  const connect = () => {
    connected = true;
    accountIdentity = pendingIdentity;
    const unsubscribeIdentity =
      subscribeAnalyticsAccountIdentity(syncAccountIdentity);
    const unsubscribeCustomerLink = subscribeAnalyticsDotyposCustomerId(() =>
      reconcile()
    );
    syncAccountIdentity();
    const unsubscribeConsent = visitorConsent.subscribe(syncConsent);
    startSdk();
    capturePageviewIfNeeded();

    return () => {
      connected = false;
      unsubscribeIdentity();
      unsubscribeCustomerLink();
      unsubscribeConsent();
      cancelSdkLoad?.();
      cancelSdkLoad = undefined;
      stopSessionIdSubscription?.();
      stopSessionIdSubscription = undefined;
      // Pause without withdrawing: the next page mount resumes the identity.
      accountIdentity = pendingIdentity;
      identityController?.reconcile(
        telemetryHostAllowed && currentConsent(),
        accountIdentity
      );
    };
  };

  const sync = (next: BrowserAnalyticsSettings) => {
    const previous = settings;
    settings = next;

    if (previous?.analyticsAccepted !== next.analyticsAccepted) {
      consentSignal = next.analyticsAccepted;
    }

    const hostAllowed = telemetryHostAllowedFor(next.posthogHost);
    const hostAllowedChanged =
      previous === undefined || telemetryHostAllowed !== hostAllowed;
    telemetryHostAllowed = hostAllowed;
    if (hostAllowedChanged && !hostAllowed) pauseForUnsafeTelemetryHost();

    if (connected && (hostAllowedChanged || changesSdkStart(previous, next))) {
      startSdk();
    }

    if (previous === undefined || previous.pathname !== next.pathname) {
      capturePageviewIfNeeded(next.pathname);
    }
  };

  return {
    connect,
    featureFlagClient: {
      getClient: () => sdkModule.getLoaded()?.default,
      subscribe: sdkModule.subscribe,
    },
    sync,
  };
}
