"use client";

import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import { PostHogProvider as ReactPostHogProvider } from "@posthog/react";
import { usePathname } from "next/navigation";
import posthog, { type BeforeSendFn } from "posthog-js";
import { type ReactNode, useEffect } from "react";
import { env } from "@/env";
import type { AnalyticsAccountIdentity } from "@/features/account/analytics-identity";
import {
  getAnalyticsAccountIdentity,
  refreshAnalyticsAccountIdentity,
  subscribeAnalyticsAccountIdentity,
} from "@/features/account/analytics-identity";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";
import { applyFeatureFlagOverrides } from "@/features/feature-flags/react";
import {
  getAcceptedConsentCategoriesFromCookieValue,
  getConsentCookieValuesFromCookie,
} from "@/shared/utils/consent-cookie";
import {
  createPostHogSessionClearCookieStrings,
  createPostHogSessionCookieStrings,
  writePostHogSessionCookie,
} from "@/shared/utils/posthog-session-cookies";
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

let hasInitializedPostHog = false;
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
let hasReadyAnalyticsConsent = false;
let analyticsTelemetryHostAllowed = false;

export function PostHogProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <ReactPostHogProvider client={posthog}>{children}</ReactPostHogProvider>
  );
}

type PostHogAnalyticsProps = {
  analyticsAccepted: boolean;
  children: ReactNode;
  featureFlagOverrides?: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;
  posthogEnvironment: string;
};

export function PostHogAnalytics({
  analyticsAccepted,
  children,
  featureFlagOverrides,
  posthogEnvironment,
}: PostHogAnalyticsProps) {
  const pathname = usePathname();
  const posthogProjectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  if (!posthogProjectToken) return children;

  const posthogHost = env.NEXT_PUBLIC_POSTHOG_HOST;
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
  posthogEnvironment: string;
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
      reconcilePostHogIdentity();
    };

    const unsubscribe = subscribeAnalyticsAccountIdentity(
      syncAnalyticsAccountIdentity
    );
    syncAnalyticsAccountIdentity();

    return unsubscribe;
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

  useEffect(() => {
    if (!analyticsAccepted && !hasInitializedPostHog) {
      clearPostHogSessionCookies();
      return;
    }

    if (!getCurrentAnalyticsConsent()) {
      reconcilePostHogIdentity();
      if (!hasInitializedPostHog) clearPostHogSessionCookies();
      return;
    }

    if (
      !telemetryHostAllowed ||
      !analyticsTelemetryHostAllowed ||
      !posthogHost
    ) {
      return;
    }

    if (!hasInitializedPostHog) {
      initializePostHog({
        posthogEnvironment,
        posthogHost,
        posthogProjectToken,
      });
    }

    ensurePostHogSessionIdSubscription();
    applyFeatureFlagOverrides(posthog, featureFlagOverrides);
    reconcilePostHogIdentity();
  }, [
    analyticsAccepted,
    featureFlagOverrides,
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

function initializePostHog({
  posthogEnvironment,
  posthogHost,
  posthogProjectToken,
}: {
  readonly posthogEnvironment: string;
  readonly posthogHost: string;
  readonly posthogProjectToken: string;
}) {
  if (hasInitializedPostHog) return;
  if (!analyticsTelemetryHostAllowed) return;

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
  clearPostHogInitialPersonProperties();
  hasInitializedPostHog = true;
  posthog.stopSessionRecording();
  posthogIdentityController = createPostHogIdentityController(posthog, {
    onPause: handlePostHogPause,
    onReady: handlePostHogReady,
  });
}

function clearPostHogInitialPersonProperties() {
  // These are the posthog-js 1.418.1 persistence keys. Re-audit the keys when
  // upgrading the SDK; save_referrer/save_campaign_params do not clear old data.
  posthog.unregister("$initial_person_info");
  posthog.unregister("$initial_referrer_info");
  posthog.unregister("$initial_campaign_params");
}

function ensurePostHogSessionIdSubscription() {
  if (!hasInitializedPostHog || posthogSessionIdUnsubscribe) return;

  posthogSessionIdUnsubscribe = posthog.onSessionId((sessionId) => {
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

  const sdkDistinctId = posthog.get_distinct_id();
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

function pausePostHogForUnsafeTelemetryHost() {
  analyticsTelemetryHostAllowed = false;
  posthogIdentityController?.reconcile(false, analyticsAccountIdentity);
  clearPostHogSessionCookies();
}

function isSettledAnalyticsAccountIdentity(
  identity: AnalyticsAccountIdentity
): identity is SettledAnalyticsAccountIdentity {
  return identity.status === "anonymous" || identity.status === "authenticated";
}

function isSdkIdentityReady(identity: SettledAnalyticsAccountIdentity) {
  const sdkUserState = posthog.get_property("$user_state");
  if (identity.status === "anonymous") return sdkUserState !== "identified";

  return (
    sdkUserState === "identified" &&
    posthog.get_distinct_id() ===
      getPostHogAccountDistinctId(identity.accountId)
  );
}

function handlePostHogPause() {
  const consented =
    analyticsTelemetryHostAllowed && getCurrentAnalyticsConsent();
  if (!consented) {
    lastCapturedPageviewPath = undefined;
    lastReadyAnalyticsAccountIdentity = undefined;
    hasReadyAnalyticsConsent = false;
  }

  posthog.set_config({
    advanced_disable_feature_flags: true,
    tracing_headers: [],
  });
  posthog.stopSessionRecording();
  clearPostHogSessionCookies();
}

function handlePostHogReady() {
  if (!analyticsTelemetryHostAllowed) return;

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
  clearPostHogInitialPersonProperties();
  if (!analyticsTelemetryHostAllowed) return;
  posthog.set_config({
    advanced_disable_feature_flags: false,
    tracing_headers: [window.location.hostname],
  });
  posthog.reloadFeatureFlags();
  capturePostHogPageviewIfNeeded();
}

function sameSettledAnalyticsAccountIdentity(
  left: SettledAnalyticsAccountIdentity,
  right: SettledAnalyticsAccountIdentity
) {
  if (left.status !== right.status) return false;
  if (left.status === "anonymous") return true;
  return right.status === "authenticated" && left.accountId === right.accountId;
}

function syncPostHogSessionCookies(sessionId = posthog.get_session_id()) {
  if (!isPostHogIdentityReady(getAnalyticsAccountIdentity())) return;

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
  posthog.capture("$pageview", { $current_url: pageUrl });
}

function getCurrentAnalyticsConsent() {
  const consentFromCookie = readAnalyticsConsentCookie();
  return analyticsConsentSignal && consentFromCookie === true;
}

function readAnalyticsConsentCookie(): boolean {
  if (globalThis.document === undefined) return false;

  const consentCookieValues = getConsentCookieValuesFromCookie(document.cookie);
  if (consentCookieValues.length === 0) return false;

  return consentCookieValues.every((cookieValue) => {
    let hasUnexpectedValue = false;
    const acceptedCategories = getAcceptedConsentCategoriesFromCookieValue(
      cookieValue,
      { onUnexpectedValue: () => (hasUnexpectedValue = true) }
    );

    return !hasUnexpectedValue && acceptedCategories.includes("analytics");
  });
}
