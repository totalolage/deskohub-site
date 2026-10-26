"use client";

import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import {
  PostHogClientProvider,
  type PostHogClientSource,
} from "@deskohub/posthog/feature-flags/react";
import { usePathname } from "next/navigation";
import type { BeforeSendFn, PostHog } from "posthog-js";
import { type ReactNode, useEffect, useReducer } from "react";
import { getClientEnv } from "@/client-env";
import {
  getAnalyticsDotyposCustomerId,
  requestAnalyticsDotyposCustomerId,
  subscribeAnalyticsDotyposCustomerId,
} from "@/features/account/analytics-customer-link";
import type { AnalyticsAccountIdentity } from "@/features/account/analytics-identity";
import {
  getAnalyticsAccountIdentity,
  refreshAnalyticsAccountIdentity,
  subscribeAnalyticsAccountIdentity,
} from "@/features/account/analytics-identity";
import { captureRecordedSignInCompletion } from "@/features/account/sign-in-analytics";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";
import { applyFeatureFlagOverrides } from "@/features/feature-flags/react";
import type { DeploymentEnvironment } from "@/shared/backend/config/deployment-request-timeout";
import {
  deliverWorkspaceBrowserLogs,
  discardWorkspaceBrowserLogs,
  type WorkspaceBrowserLogRecord,
} from "@/shared/browser/workspace-browser-logs";
import { isConsentCategoryAcceptedInCookie } from "@/shared/utils/consent-cookie";
import {
  createPostHogSessionClearCookieStrings,
  createPostHogSessionCookieStrings,
  writePostHogSessionCookie,
} from "@/shared/utils/posthog-session-cookies";
import { createPreloadableModule } from "@/shared/utils/preloadable-module";
import {
  deliverAnalyticsEvents,
  discardAnalyticsEvents,
} from "../analytics-events";
import {
  CONSENT_UPDATED_EVENT,
  CONSENT_UPDATED_STORAGE_KEY,
} from "../utils/consent-event";
import {
  createPostHogConfig,
  isPostHogTelemetryHostAllowed,
} from "../utils/posthog-config";
import { preparePostHogEvent } from "../utils/posthog-event";
import {
  createPostHogIdentityController,
  getPostHogAccountDistinctId,
} from "../utils/posthog-identity";
import { createPostHogPageUrl } from "../utils/posthog-url";

// The SDK stays out of the initial bundle and loads only once analytics
// consent lets it initialize.
const posthogModule = createPreloadableModule(() => import("posthog-js"));
const posthogClientSource: PostHogClientSource = {
  getClient: () => posthogModule.getLoaded()?.default,
  subscribe: posthogModule.subscribe,
};
let initializedPostHog: PostHog | undefined;
let analyticsAccountIdentity: AnalyticsAccountIdentity = { status: "pending" };
let analyticsConsentSignal = false;
let analyticsPathname: string | null = null;
let posthogIdentityController:
  | ReturnType<typeof createPostHogIdentityController>
  | undefined;
let posthogSessionIdUnsubscribe: (() => void) | undefined;
let lastCapturedPageviewPath: string | undefined;
type SettledAnalyticsAccountIdentity = Extract<
  AnalyticsAccountIdentity,
  { readonly status: "anonymous" | "authenticated" }
>;
let lastReadyAnalyticsAccountIdentity:
  | SettledAnalyticsAccountIdentity
  | undefined;
let lastSettledAnalyticsAccountIdentity:
  | SettledAnalyticsAccountIdentity
  | undefined;
let hasReadyAnalyticsConsent = false;
let analyticsTelemetryHostAllowed = false;
let workspaceBrowserLogSink:
  | ((record: WorkspaceBrowserLogRecord) => void)
  | undefined;
let detachWorkspaceBrowserLogs: (() => void) | undefined;
let detachAnalyticsEvents: (() => void) | undefined;

export function PostHogProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <PostHogClientProvider client={posthogClientSource}>
      {children}
    </PostHogClientProvider>
  );
}

type PostHogAnalyticsProps = {
  analyticsAccepted: boolean;
  children: ReactNode;
  featureFlagOverrides?: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;
  posthogEnvironment: DeploymentEnvironment;
};

export function PostHogAnalytics({
  analyticsAccepted,
  children,
  featureFlagOverrides,
  posthogEnvironment,
}: PostHogAnalyticsProps) {
  const pathname = usePathname();
  const clientEnv = getClientEnv();
  const posthogProjectToken = clientEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  if (!posthogProjectToken) return children;

  const posthogHost = clientEnv.NEXT_PUBLIC_POSTHOG_HOST;
  const applicationHostname = globalThis.window?.location.hostname;
  const telemetryHostAllowed =
    posthogHost !== undefined &&
    applicationHostname !== undefined &&
    isPostHogTelemetryHostAllowed(posthogHost, applicationHostname);

  return (
    <>
      <PostHogClient
        analyticsAccepted={analyticsAccepted}
        featureFlagOverrides={featureFlagOverrides}
        pathname={pathname}
        telemetryHostAllowed={telemetryHostAllowed}
        posthogEnvironment={posthogEnvironment}
        posthogHost={posthogHost}
        posthogProjectToken={posthogProjectToken}
      />
      {children}
    </>
  );
}

type PostHogClientProps = {
  analyticsAccepted: boolean;
  featureFlagOverrides?: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;
  pathname: string | null;
  posthogEnvironment: DeploymentEnvironment;
  posthogHost: string | undefined;
  posthogProjectToken: string;
  telemetryHostAllowed: boolean;
};

function PostHogClient({
  analyticsAccepted,
  featureFlagOverrides,
  pathname,
  telemetryHostAllowed,
  posthogEnvironment,
  posthogHost,
  posthogProjectToken,
}: PostHogClientProps) {
  const [loadAttempt, retryLoad] = useReducer(
    (attempt: number) => attempt + 1,
    0
  );

  useEffect(() => {
    analyticsConsentSignal = analyticsAccepted;
  }, [analyticsAccepted]);

  useEffect(() => {
    analyticsPathname = pathname;
  }, [pathname]);

  useEffect(() => {
    analyticsTelemetryHostAllowed = telemetryHostAllowed;
    if (!telemetryHostAllowed) {
      pausePostHogForUnsafeTelemetryHost();
    }
  }, [telemetryHostAllowed]);

  useEffect(() => {
    analyticsAccountIdentity = { status: "pending" };

    const syncAnalyticsAccountIdentity = () => {
      analyticsAccountIdentity = getAnalyticsAccountIdentity();
      discardAnalyticsEventsAfterLeavingAccount(analyticsAccountIdentity);
      reconcilePostHogIdentity();
    };

    const unsubscribe = subscribeAnalyticsAccountIdentity(
      syncAnalyticsAccountIdentity
    );
    const unsubscribeCustomerLink = subscribeAnalyticsDotyposCustomerId(() =>
      reconcilePostHogIdentity()
    );
    syncAnalyticsAccountIdentity();

    return () => {
      unsubscribe();
      unsubscribeCustomerLink();
    };
  }, []);

  useEffect(() => {
    type ConsentSyncSource = "explicit" | "focus" | "storage";

    const syncConsentFromCookie = (source: ConsentSyncSource) => {
      const wasConsented = getCurrentAnalyticsConsent();
      const consented = readAnalyticsConsentCookie();
      analyticsConsentSignal = consented;

      const shouldRefreshIdentity =
        consented &&
        (source === "explicit" || (source === "storage" && !wasConsented));
      if (shouldRefreshIdentity) {
        void refreshAnalyticsAccountIdentity().catch(() => undefined);
      }

      reconcilePostHogIdentity(consented);
    };

    const handleConsentUpdated = () => {
      syncConsentFromCookie("explicit");
    };

    const handleConsentStorage = (event: StorageEvent) => {
      if (event.key !== CONSENT_UPDATED_STORAGE_KEY) return;
      syncConsentFromCookie("storage");
    };
    const handleFocus = () => syncConsentFromCookie("focus");

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      handleFocus();
    };

    window.addEventListener(CONSENT_UPDATED_EVENT, handleConsentUpdated);
    window.addEventListener("storage", handleConsentStorage);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener(CONSENT_UPDATED_EVENT, handleConsentUpdated);
      window.removeEventListener("storage", handleConsentStorage);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadAttempt re-runs the SDK load after a failed chunk fetch.
  useEffect(() => {
    if (!analyticsAccepted && !initializedPostHog) {
      clearPostHogSessionCookies();
      return;
    }

    if (!getCurrentAnalyticsConsent()) {
      reconcilePostHogIdentity();
      if (!initializedPostHog) clearPostHogSessionCookies();
      return;
    }

    if (
      !telemetryHostAllowed ||
      !analyticsTelemetryHostAllowed ||
      !posthogHost
    ) {
      return;
    }

    const startPostHog = (client: PostHog) => {
      ensurePostHogSessionIdSubscription();
      applyFeatureFlagOverrides(client, featureFlagOverrides);
      reconcilePostHogIdentity();
    };

    if (initializedPostHog) {
      startPostHog(initializedPostHog);
      return;
    }

    let current = true;
    // A failed chunk load is retried once the browser is back online or the
    // tab regains focus; events captured meanwhile keep waiting.
    const retryEvents = ["focus", "online"] as const;
    const stopRetryListeners = () => {
      for (const event of retryEvents) {
        window.removeEventListener(event, retryLoad);
      }
    };
    posthogModule.load().then(
      ({ default: sdk }) => {
        if (!current) return;
        const client = initializePostHog(sdk, {
          posthogEnvironment,
          posthogHost,
          posthogProjectToken,
        });
        if (client) startPostHog(client);
      },
      () => {
        if (!current) return;
        for (const event of retryEvents) {
          window.addEventListener(event, retryLoad);
        }
      }
    );

    return () => {
      current = false;
      stopRetryListeners();
    };
  }, [
    analyticsAccepted,
    featureFlagOverrides,
    loadAttempt,
    posthogEnvironment,
    posthogHost,
    posthogProjectToken,
    telemetryHostAllowed,
  ]);

  useEffect(() => {
    capturePostHogPageviewIfNeeded(pathname);
  }, [pathname]);

  useEffect(
    () => () => {
      posthogSessionIdUnsubscribe?.();
      posthogSessionIdUnsubscribe = undefined;
      pausePostHogObserver();
    },
    []
  );

  return null;
}

function initializePostHog(
  posthog: PostHog,
  {
    posthogEnvironment,
    posthogHost,
    posthogProjectToken,
  }: {
    readonly posthogEnvironment: DeploymentEnvironment;
    readonly posthogHost: string;
    readonly posthogProjectToken: string;
  }
): PostHog | undefined {
  if (initializedPostHog) return initializedPostHog;
  // Consent or the telemetry host can change while the SDK loads.
  if (!analyticsTelemetryHostAllowed || !getCurrentAnalyticsConsent()) return;

  posthog.init(
    posthogProjectToken,
    createPostHogConfig({
      apiHost: posthogHost,
      beforeSend: (event) => {
        if (!event) return event;
        if (!isPostHogEventAllowed(event)) return null;

        return preparePostHogEvent(event, posthogEnvironment);
      },
      optOutUseragentFilter: process.env.NODE_ENV === "development",
    })
  );
  clearPostHogInitialPersonProperties(posthog);
  initializedPostHog = posthog;
  workspaceBrowserLogSink = createWorkspaceBrowserLogSink(
    posthog,
    posthogEnvironment
  );
  posthog.stopSessionRecording();
  posthogIdentityController = createPostHogIdentityController(posthog, {
    deploymentEnvironment: posthogEnvironment,
    onPause: handlePostHogPause,
    onReady: handlePostHogReady,
    readDotyposCustomerId: getAnalyticsDotyposCustomerId,
  });
  return posthog;
}

function clearPostHogInitialPersonProperties(posthog: PostHog) {
  // These are the posthog-js 1.418.1 persistence keys. Re-audit the keys when
  // upgrading the SDK; save_referrer/save_campaign_params do not clear old data.
  posthog.unregister("$initial_person_info");
  posthog.unregister("$initial_referrer_info");
  posthog.unregister("$initial_campaign_params");
}

function ensurePostHogSessionIdSubscription() {
  if (!initializedPostHog || posthogSessionIdUnsubscribe) return;

  posthogSessionIdUnsubscribe = initializedPostHog.onSessionId((sessionId) => {
    syncPostHogSessionCookies(sessionId);
  });
}

function pausePostHogObserver() {
  analyticsAccountIdentity = { status: "pending" };
  posthogIdentityController?.reconcile(
    analyticsTelemetryHostAllowed ? getCurrentAnalyticsConsent() : false,
    analyticsAccountIdentity
  );
}

function reconcilePostHogIdentity(consented = getCurrentAnalyticsConsent()) {
  // Events and browser logs held while analytics is paused never outlive its
  // consent. The cookie decides: the consent signal reads as withdrawn until
  // the consent state hydrates.
  if (!analyticsTelemetryHostAllowed || !readAnalyticsConsentCookie()) {
    discardAnalyticsEvents();
    discardWorkspaceBrowserLogs();
  }

  if (!analyticsTelemetryHostAllowed) {
    if (!posthogIdentityController) {
      clearPostHogSessionCookies();
      return;
    }

    posthogIdentityController.reconcile(false, analyticsAccountIdentity);
    return;
  }

  if (!posthogIdentityController) {
    if (!consented) clearPostHogSessionCookies();
    return;
  }

  posthogIdentityController.reconcile(consented, analyticsAccountIdentity);
}

function isPostHogEventAllowed(
  event: NonNullable<Parameters<BeforeSendFn>[0]>
) {
  const identity = getAnalyticsAccountIdentity();
  if (!isPostHogIdentityReady(identity)) return false;

  const sdkDistinctId = initializedPostHog?.get_distinct_id();
  if (event.properties.distinct_id !== sdkDistinctId) return false;
  if (event.event === "$identify" && identity.status !== "authenticated") {
    return false;
  }

  return true;
}

function isPostHogIdentityReady(
  identity: AnalyticsAccountIdentity
): identity is SettledAnalyticsAccountIdentity {
  return (
    analyticsTelemetryHostAllowed &&
    posthogIdentityController?.isReady() === true &&
    getCurrentAnalyticsConsent() &&
    isSettledAnalyticsAccountIdentity(identity) &&
    isSdkIdentityReady(identity)
  );
}

// Leaving an account resets the SDK identity, so events held from the
// account's session, including those held before the SDK loaded, must not
// follow the visitor to the next identity.
function discardAnalyticsEventsAfterLeavingAccount(
  identity: AnalyticsAccountIdentity
) {
  if (!isSettledAnalyticsAccountIdentity(identity)) return;

  if (
    lastSettledAnalyticsAccountIdentity?.status === "authenticated" &&
    !sameSettledAnalyticsAccountIdentity(
      lastSettledAnalyticsAccountIdentity,
      identity
    )
  ) {
    discardAnalyticsEvents();
  }
  lastSettledAnalyticsAccountIdentity = identity;
}

function pausePostHogForUnsafeTelemetryHost() {
  analyticsTelemetryHostAllowed = false;
  discardAnalyticsEvents();
  posthogIdentityController?.reconcile(false, analyticsAccountIdentity);
  clearPostHogSessionCookies();
}

function isSettledAnalyticsAccountIdentity(
  identity: AnalyticsAccountIdentity
): identity is SettledAnalyticsAccountIdentity {
  return identity.status === "anonymous" || identity.status === "authenticated";
}

function isSdkIdentityReady(identity: SettledAnalyticsAccountIdentity) {
  const posthog = initializedPostHog;
  if (!posthog) return false;

  const sdkUserState = posthog.get_property("$user_state");
  if (identity.status === "anonymous") return sdkUserState !== "identified";

  return (
    sdkUserState === "identified" &&
    posthog.get_distinct_id() ===
      getPostHogAccountDistinctId(identity.accountId)
  );
}

function handlePostHogPause() {
  detachAnalyticsEvents?.();
  detachAnalyticsEvents = undefined;
  detachWorkspaceBrowserLogs?.();
  detachWorkspaceBrowserLogs = undefined;

  const consented =
    analyticsTelemetryHostAllowed && getCurrentAnalyticsConsent();
  if (!consented) {
    lastCapturedPageviewPath = undefined;
    lastReadyAnalyticsAccountIdentity = undefined;
    hasReadyAnalyticsConsent = false;
  }

  initializedPostHog?.set_config({
    advanced_disable_feature_flags: true,
    tracing_headers: [],
  });
  initializedPostHog?.stopSessionRecording();
  clearPostHogSessionCookies();
}

function handlePostHogReady() {
  const posthog = initializedPostHog;
  if (!posthog || !analyticsTelemetryHostAllowed) return;

  const identity = getAnalyticsAccountIdentity();
  if (!isPostHogIdentityReady(identity)) return;

  const identityChanged =
    !lastReadyAnalyticsAccountIdentity ||
    !sameSettledAnalyticsAccountIdentity(
      lastReadyAnalyticsAccountIdentity,
      identity
    );
  const wasReconsented = !hasReadyAnalyticsConsent;
  if (identityChanged || wasReconsented) {
    lastCapturedPageviewPath = undefined;
  }
  lastReadyAnalyticsAccountIdentity = identity;
  hasReadyAnalyticsConsent = true;

  syncPostHogSessionCookies();
  clearPostHogInitialPersonProperties(posthog);
  if (!analyticsTelemetryHostAllowed) return;
  posthog.set_config({
    advanced_disable_feature_flags: false,
    tracing_headers: [window.location.hostname],
  });
  posthog.reloadFeatureFlags();
  capturePostHogPageviewIfNeeded();
  // Events captured while analytics was loading or paused follow the pageview.
  detachAnalyticsEvents ??= deliverAnalyticsEvents(({ event, properties }) => {
    posthog.capture(event, properties);
  });
  if (identity.status === "authenticated") {
    // A sign-in recorded before this page load lands on the settled account.
    captureRecordedSignInCompletion();
    requestAnalyticsDotyposCustomerId(identity.accountId);
  }
  if (workspaceBrowserLogSink) {
    detachWorkspaceBrowserLogs ??= deliverWorkspaceBrowserLogs(
      workspaceBrowserLogSink
    );
  }
}

// Browser logs wait for the same consented, settled identity as events: a
// record logged while analytics is paused is delivered once it resumes.
function createWorkspaceBrowserLogSink(
  posthog: PostHog,
  posthogEnvironment: string
) {
  return ({ attributes, body, level }: WorkspaceBrowserLogRecord) => {
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
}

function sameSettledAnalyticsAccountIdentity(
  left: SettledAnalyticsAccountIdentity,
  right: SettledAnalyticsAccountIdentity
) {
  if (left.status !== right.status) return false;
  if (left.status === "anonymous") return true;
  return right.status === "authenticated" && left.accountId === right.accountId;
}

function syncPostHogSessionCookies(
  sessionId = initializedPostHog?.get_session_id()
) {
  const posthog = initializedPostHog;
  if (
    !posthog ||
    sessionId === undefined ||
    !isPostHogIdentityReady(getAnalyticsAccountIdentity())
  ) {
    return;
  }

  for (const cookie of createPostHogSessionCookieStrings({
    distinctId: posthog.get_distinct_id(),
    sessionId,
  })) {
    writePostHogSessionCookie(cookie);
  }
}

function clearPostHogSessionCookies() {
  for (const cookie of createPostHogSessionClearCookieStrings()) {
    writePostHogSessionCookie(cookie);
  }
}

function capturePostHogPageviewIfNeeded(pathname = analyticsPathname) {
  if (!isPostHogIdentityReady(getAnalyticsAccountIdentity())) return;

  const pageviewPath = pathname ?? window.location.pathname;
  if (!pageviewPath || lastCapturedPageviewPath === pageviewPath) return;

  const pageUrl = createPostHogPageUrl(window.location.href);
  lastCapturedPageviewPath = pageviewPath;
  initializedPostHog?.capture("$pageview", { $current_url: pageUrl });
}

function getCurrentAnalyticsConsent() {
  const consentFromCookie = readAnalyticsConsentCookie();
  return analyticsConsentSignal && consentFromCookie === true;
}

function readAnalyticsConsentCookie(): boolean {
  if (globalThis.document === undefined) return false;

  return isConsentCategoryAcceptedInCookie(document.cookie, "analytics");
}
