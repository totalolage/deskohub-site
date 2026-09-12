"use client";

import { Schema } from "effect";
import posthog from "posthog-js";
import { useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  beginAnalyticsAccountTransition,
  completeAnalyticsAccountSignOut,
  getAnalyticsAccountIdentity,
  refreshAnalyticsAccountIdentity,
} from "@/features/account/analytics-identity";
import { authClient } from "@/features/account/auth.client";
import {
  PostHogAnalytics,
  PostHogProvider,
} from "@/features/cookie-consent/components/posthog-analytics";
import { useCookieConsent } from "@/features/cookie-consent/hooks/use-cookie-consent";
import { dispatchConsentUpdatedEvent } from "@/features/cookie-consent/utils/consent-event";
import {
  CONSENT_COOKIE_NAME,
  getAcceptedConsentCategoriesFromCookie,
  getConsentCookieValuesFromCookie,
} from "@/shared/utils/consent-cookie";

const syntheticEmail = "posthog.identity.synthetic@example.test";
const syntheticName = "PostHog Identity Synthetic Name";
const syntheticBilling = "Synthetic Billing Street, Test City";
const syntheticPin = "583104729";
const legacyInitialRawQueryToken = "posthog-identity-legacy-raw-query-token";
const legacyInitialReferrerToken = "posthog-identity-legacy-referrer-token";
const legacyInitialUtmToken = "posthog-identity-legacy-utm-token";

const writeAnalyticsConsentCookie = (accepted: boolean) => {
  // biome-ignore lint/suspicious/noDocumentCookie: The browser fixture controls synthetic consent synchronously.
  document.cookie = `cc_cookie=${encodeURIComponent(
    JSON.stringify({
      categories: accepted ? ["necessary", "analytics"] : ["necessary"],
    })
  )}; Path=/`;
};

const initializeAnalyticsConsentCookie = () => {
  if (globalThis.window === undefined) return;
  const accepted =
    new URLSearchParams(window.location.search).get("consent") === "on";
  writeAnalyticsConsentCookie(accepted);
};

type FixtureSessionState = {
  readonly expiresAtMs: number | null;
  readonly expiresAtIsDate: boolean;
  readonly hasSession: boolean;
  readonly pending: boolean;
  readonly refetching: boolean;
  readonly unavailable: boolean;
};

type FixtureSdkState = {
  readonly autocaptureDisabled: boolean;
  readonly capturedEvents: number;
  readonly capturing: boolean;
  readonly deviceId: string | null;
  readonly distinctId: string;
  readonly exceptionsDisabled: boolean;
  readonly heatmapsDisabled: boolean;
  readonly hasAutocapture: boolean;
  readonly hasSessionRecording: boolean;
  readonly identified: boolean;
  readonly loaded: boolean;
  readonly queuedEvents: number;
  readonly rageclickDisabled: boolean;
  readonly recordingConfigured: boolean;
  readonly recordingStarted: boolean;
  readonly sessionRecordingDisabled: boolean;
  readonly surveysDisabled: boolean;
};

let capturedEventCount = 0;

type FixtureIdentityState = {
  readonly status: ReturnType<typeof getAnalyticsAccountIdentity>["status"];
};

type FixtureCaptureResult = {
  readonly accepted: boolean;
  readonly identityStatus: FixtureIdentityState["status"];
};

export type PostHogIdentityBrowserFixtureControl = {
  readonly captureSensitiveEvent: () => FixtureCaptureResult;
  readonly completeAnalyticsAccountSignOut: () => void;
  readonly mutateReadonlyDom: () => void;
  readonly registerLegacyInitialProperties: () => boolean;
  readonly removeConsentCookie: () => void;
  readonly readIdentityState: () => FixtureIdentityState;
  readonly readSdkState: () => FixtureSdkState;
  readonly readConsentState: () => FixtureConsentState;
  readonly readSessionState: () => FixtureSessionState;
  readonly refreshAnalyticsAccountIdentity: () => Promise<void>;
  readonly refreshSession: () => Promise<void>;
  readonly setConsent: (accepted: boolean) => void;
  readonly signOut: () => Promise<boolean>;
};

declare global {
  interface Window {
    __posthogIdentityBrowserFixture?: PostHogIdentityBrowserFixtureControl;
  }
}

type FixtureConsentState = {
  readonly analyticsAccepted: boolean;
  readonly cookiePresent: boolean;
  readonly necessaryAccepted: boolean;
};

const readSessionState = (): FixtureSessionState => {
  const snapshot = authClient.useSession.get();
  const data = snapshot.data;
  const session = data?.session;
  const expiresAtIsDate = session?.expiresAt instanceof Date;

  return {
    expiresAtIsDate,
    expiresAtMs: expiresAtIsDate ? session.expiresAt.getTime() : null,
    hasSession: data !== null && data.session !== null && data.user !== null,
    pending: snapshot.isPending,
    refetching: snapshot.isRefetching,
    unavailable: snapshot.error !== null,
  };
};

const readIdentityState = (): FixtureIdentityState => ({
  status: getAnalyticsAccountIdentity().status,
});

const readConsentState = (): FixtureConsentState => ({
  analyticsAccepted: getAcceptedConsentCategoriesFromCookie(
    document.cookie
  ).includes("analytics"),
  cookiePresent: getConsentCookieValuesFromCookie(document.cookie).length > 0,
  necessaryAccepted: getAcceptedConsentCategoriesFromCookie(
    document.cookie
  ).includes("necessary"),
});

const readStringPostHogProperty = (name: string) => {
  try {
    const value = Schema.decodeUnknownOption(Schema.String)(
      posthog.get_property(name)
    );
    return value._tag === "Some" ? value.value : null;
  } catch {
    return null;
  }
};

const readSdkState = (): FixtureSdkState => {
  let capturing = false;
  let recordingStarted = false;

  try {
    capturing = posthog.is_capturing();
  } catch {
    capturing = false;
  }

  try {
    recordingStarted = posthog.sessionRecordingStarted();
  } catch {
    recordingStarted = false;
  }

  const config = posthog.config;

  return {
    autocaptureDisabled: config?.autocapture === false,
    capturedEvents: capturedEventCount,
    capturing,
    deviceId: readStringPostHogProperty("$device_id"),
    distinctId: posthog.get_distinct_id(),
    exceptionsDisabled: config?.capture_exceptions === false,
    heatmapsDisabled: config?.capture_heatmaps === false,
    hasAutocapture: posthog.autocapture !== undefined,
    hasSessionRecording: posthog.sessionRecording !== undefined,
    identified: posthog.get_property("$user_state") === "identified",
    loaded: posthog.__loaded === true,
    queuedEvents: posthog.__request_queue?.length ?? 0,
    rageclickDisabled: config?.rageclick === false,
    recordingConfigured:
      config?.session_recording !== undefined &&
      config.disable_session_recording !== true,
    recordingStarted,
    sessionRecordingDisabled: config?.disable_session_recording === true,
    surveysDisabled: config?.disable_surveys === true,
  };
};

const registerLegacyInitialProperties = () => {
  const referrerUrl = `https://synthetic.example.test/legacy-referrer?marker=${legacyInitialReferrerToken}`;
  const pageUrl = `https://synthetic.example.test/legacy-page?raw_query=${legacyInitialRawQueryToken}&utm_source=${legacyInitialUtmToken}#legacy-hash`;
  const properties = {
    $initial_campaign_params: { utm_source: legacyInitialUtmToken },
    $initial_person_info: { r: referrerUrl, u: pageUrl },
    $initial_referrer_info: {
      $referrer: referrerUrl,
      $referring_domain: "synthetic.example.test",
    },
  };

  // These values mirror the public shapes read by posthog-js persistence:
  // get_initial_props() expands referrer/campaign objects and transforms the
  // { r, u } person-info object into $initial_* flag properties.
  posthog.register(properties);
  return Object.entries(properties).every(
    ([name, expected]) =>
      JSON.stringify(posthog.get_property(name)) === JSON.stringify(expected)
  );
};

const refreshSession = async () => {
  await authClient.useSession.get().refetch();
};

const captureSensitiveEvent = (): FixtureCaptureResult => {
  const identityStatus = getAnalyticsAccountIdentity().status;
  const capturedEventCountBefore = capturedEventCount;
  const captureResult = posthog.capture("fixture-sensitive-event", {
    fixture_surface: "readonly-dom",
  });

  return {
    accepted:
      captureResult !== undefined ||
      capturedEventCount > capturedEventCountBefore,
    identityStatus,
  };
};

const mutateReadonlyDom = () => {
  const readonlyText = document.querySelector<HTMLElement>(
    "[data-fixture-readonly-text]"
  );
  readonlyText?.setAttribute("data-fixture-dom-revision", String(Date.now()));
};

const removeConsentCookie = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: The browser fixture controls synthetic consent synchronously.
  document.cookie = `${CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`;
};

// This control covers the account-domain lifecycle used by SignOutButton, not
// the button's UI click behavior.
const signOut = async () => {
  beginAnalyticsAccountTransition();

  try {
    const result = await authClient.signOut();
    if (result.error) {
      void refreshAnalyticsAccountIdentity({ settleTransition: true }).catch(
        () => undefined
      );
      return false;
    }

    completeAnalyticsAccountSignOut();
    return true;
  } catch {
    void refreshAnalyticsAccountIdentity({ settleTransition: true }).catch(
      () => undefined
    );
    return false;
  }
};

export function PostHogIdentityBrowserFixture() {
  const { isAccepted } = useCookieConsent();
  const analyticsAccepted = isAccepted("analytics");

  const setAnalyticsConsent = useCallback((accepted: boolean) => {
    writeAnalyticsConsentCookie(accepted);
    dispatchConsentUpdatedEvent(
      accepted ? ["necessary", "analytics"] : ["necessary"]
    );
  }, []);

  useEffect(() => {
    const unsubscribeCaptureHook = posthog._addCaptureHook(() => {
      capturedEventCount += 1;
    });
    const control: PostHogIdentityBrowserFixtureControl = {
      captureSensitiveEvent,
      completeAnalyticsAccountSignOut,
      mutateReadonlyDom,
      registerLegacyInitialProperties,
      removeConsentCookie,
      readIdentityState,
      readSdkState,
      readConsentState,
      readSessionState,
      refreshAnalyticsAccountIdentity,
      refreshSession,
      setConsent: setAnalyticsConsent,
      signOut,
    };

    window.__posthogIdentityBrowserFixture = control;

    return () => {
      unsubscribeCaptureHook();
      if (window.__posthogIdentityBrowserFixture === control) {
        delete window.__posthogIdentityBrowserFixture;
      }
    };
  }, [setAnalyticsConsent]);

  return (
    <PostHogProvider>
      <PostHogAnalytics
        analyticsAccepted={analyticsAccepted}
        featureFlagOverrides={{ discount_codes: true }}
        posthogEnvironment="development"
      >
        <main data-fixture-consent={analyticsAccepted ? "accepted" : "denied"}>
          <h1>PostHog identity browser fixture</h1>
          <p data-fixture-readonly-text>
            {syntheticName} — {syntheticBilling} — {syntheticEmail} — PIN{" "}
            {syntheticPin}
          </p>
          <input
            aria-label="Synthetic readonly email"
            data-fixture-readonly-input
            readOnly
            value={syntheticEmail}
          />
          <button
            data-fixture-consent-off
            onClick={() => setAnalyticsConsent(false)}
            type="button"
          >
            Withdraw analytics consent
          </button>
          <button
            data-fixture-consent-on
            onClick={() => setAnalyticsConsent(true)}
            type="button"
          >
            Grant analytics consent
          </button>
          <button
            data-fixture-capture
            onClick={captureSensitiveEvent}
            type="button"
          >
            Capture synthetic event
          </button>
        </main>
      </PostHogAnalytics>
    </PostHogProvider>
  );
}

export function mountPostHogIdentityBrowserFixture() {
  const root = document.getElementById("posthog-identity-fixture-root");
  if (!root) throw new Error("PostHog identity fixture root is missing");
  createRoot(root).render(<PostHogIdentityBrowserFixture />);
}

if (globalThis.document !== undefined) {
  initializeAnalyticsConsentCookie();
  mountPostHogIdentityBrowserFixture();
}
