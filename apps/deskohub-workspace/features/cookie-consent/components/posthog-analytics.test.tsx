import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type {
  BeforeSendFn,
  CapturedNetworkRequest,
  CaptureResult,
  PostHogConfig,
} from "posthog-js";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  CONSENT_UPDATED_EVENT,
  CONSENT_UPDATED_STORAGE_KEY,
} from "../utils/consent-event";

process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://posthog.example";
let posthogHost = "https://posthog.example";

mock.module("@/env", () => ({
  env: {
    get NEXT_PUBLIC_POSTHOG_HOST() {
      return posthogHost;
    },
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
  },
}));

type TestAnalyticsAccountIdentity =
  | { readonly status: "pending" | "unavailable" | "anonymous" }
  | { readonly accountId: string; readonly status: "authenticated" };

let analyticsAccountIdentity: TestAnalyticsAccountIdentity = {
  status: "pending",
};
const analyticsAccountIdentityListeners = new Set<() => void>();
const publishAnalyticsAccountIdentity = (
  identity: TestAnalyticsAccountIdentity
) => {
  analyticsAccountIdentity = identity;
  for (const listener of analyticsAccountIdentityListeners) listener();
};
let refreshedAnalyticsAccountIdentity: TestAnalyticsAccountIdentity | undefined;
const refreshAnalyticsAccountIdentity = mock(async () => {
  const nextIdentity =
    refreshedAnalyticsAccountIdentity ?? analyticsAccountIdentity;
  publishAnalyticsAccountIdentity({ status: "pending" });
  await Promise.resolve();
  publishAnalyticsAccountIdentity(nextIdentity);
});
const getAnalyticsAccountIdentity = mock(() => analyticsAccountIdentity);
const subscribeAnalyticsAccountIdentity = mock((listener: () => void) => {
  analyticsAccountIdentityListeners.add(listener);
  return () => analyticsAccountIdentityListeners.delete(listener);
});

mock.module("@/features/account/analytics-identity", () => ({
  getAnalyticsAccountIdentity,
  refreshAnalyticsAccountIdentity,
  subscribeAnalyticsAccountIdentity,
}));

let currentDistinctId = "visitor-id";
let currentUserState: "anonymous" | "identified" = "anonymous";
let initConfig: Partial<PostHogConfig> | undefined;
const featureFlagListeners = new Set<() => void>();
let featureFlagOverrides: Readonly<Record<string, boolean | string>> = {};
const capturedEvents: CaptureResult[] = [];
let sessionIdListener: ((sessionId: string) => void) | undefined;
let sessionCookiesDuringIdentify = "";
let seededInitialPersonProperties: Record<string, string> = {};
const posthogLifecycle: string[] = [];

const init = mock((_token: string, config?: Partial<PostHogConfig>) => {
  posthogLifecycle.push("init");
  initConfig = config;
  return posthog;
});
const capture = mock(
  (eventName: string, properties?: CaptureResult["properties"]) => {
    const event: CaptureResult = {
      event: eventName,
      properties: {
        distinct_id: currentDistinctId,
        ...(properties ?? {}),
      },
      uuid: "019ee060-bc9f-7070-aea9-9440835fe38f",
    };

    const beforeSend = initConfig?.before_send;
    if (!beforeSend || Array.isArray(beforeSend)) {
      capturedEvents.push(event);
      return event;
    }

    const preparedEvent = beforeSend(event);
    if (preparedEvent) capturedEvents.push(preparedEvent);
    return preparedEvent ?? undefined;
  }
);
const identify = mock((distinctId?: string) => {
  posthogLifecycle.push("identify");
  if (distinctId !== undefined) currentDistinctId = distinctId;
  currentUserState = "identified";
  sessionIdListener?.("session-before-ready");
  sessionCookiesDuringIdentify = document.cookie;
  capture("$identify");
});
const optInCapturing = mock(
  (_options?: { readonly captureEventName?: string | false }) => undefined
);
const optOutCapturing = mock(() => undefined);
const reset = mock((_options?: boolean) => {
  currentDistinctId = "anonymous-after-reset";
  currentUserState = "anonymous";
});
const unregister = mock((property: string) => {
  posthogLifecycle.push(`unregister:${property}`);
  delete seededInitialPersonProperties[property];
});
const overrideFeatureFlags = mock(
  (
    overrides:
      | false
      | {
          readonly flags: Readonly<Record<string, boolean | string>>;
        }
  ) => {
    featureFlagOverrides = overrides === false ? {} : overrides.flags;
    for (const listener of featureFlagListeners) listener();
  }
);
const setConfig = mock((config: Partial<PostHogConfig>) => {
  if (config.advanced_disable_feature_flags === false) {
    posthogLifecycle.push("enable-feature-flags");
  }
});
const reloadFeatureFlags = mock(() => {
  posthogLifecycle.push("reload-feature-flags");
});
const startSessionRecording = mock(() => undefined);
const stopSessionRecording = mock(() => undefined);
const onSessionId = mock((listener: (sessionId: string) => void) => {
  sessionIdListener = listener;
  return () => {
    if (sessionIdListener === listener) sessionIdListener = undefined;
  };
});

const posthog = {
  capture,
  featureFlags: {
    hasLoadedFlags: false,
    overrideFeatureFlags,
  },
  get_distinct_id: () => currentDistinctId,
  get_property: (propertyName: string) =>
    propertyName === "$user_state" ? currentUserState : undefined,
  get_session_id: () => "session-id",
  identify,
  init,
  isFeatureEnabled: (key: string) => {
    const value = featureFlagOverrides[key];
    return value === undefined ? undefined : value !== false;
  },
  onFeatureFlags: (listener: () => void) => {
    featureFlagListeners.add(listener);
    return () => {
      featureFlagListeners.delete(listener);
    };
  },
  onSessionId,
  opt_in_capturing: optInCapturing,
  opt_out_capturing: optOutCapturing,
  reloadFeatureFlags,
  reset,
  set_config: setConfig,
  startSessionRecording,
  stopSessionRecording,
  unregister,
};

mock.module("posthog-js", () => ({ default: posthog }));

let pathname = "/account";
mock.module("next/navigation", () => ({
  usePathname: () => pathname,
}));

const setConsentCookie = (categories: readonly unknown[]) => {
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to control consent synchronously.
  document.cookie = `${createConsentCookieString(categories)}; Path=/`;
};

const createConsentCookieString = (categories: readonly unknown[]) =>
  `cc_cookie=${encodeURIComponent(JSON.stringify({ categories }))}`;

const clearConsentCookie = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to simulate another tab removing consent.
  document.cookie = "cc_cookie=; Path=/; Max-Age=0";
};

const withDocumentCookieString = (
  cookieString: string,
  callback: () => void
) => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "cookie"
  );

  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => cookieString,
    set: () => undefined,
  });

  try {
    callback();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(document, "cookie", originalDescriptor);
    } else {
      Reflect.deleteProperty(document, "cookie");
    }
  }
};

const createEvent = (
  event: string,
  properties: CaptureResult["properties"]
): CaptureResult => ({
  event,
  properties: {
    distinct_id: currentDistinctId,
    ...properties,
  },
  uuid: "019ee060-bc9f-7070-aea9-9440835fe38f",
});

describe("PostHogAnalytics", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    window.happyDOM.setURL("https://deskohub.test/account");
    posthogHost = "https://posthog.example";
    analyticsAccountIdentity = { status: "pending" };
    refreshedAnalyticsAccountIdentity = undefined;
    analyticsAccountIdentityListeners.clear();
    currentDistinctId = "visitor-id";
    currentUserState = "anonymous";
    initConfig = undefined;
    featureFlagListeners.clear();
    featureFlagOverrides = {};
    capturedEvents.length = 0;
    sessionIdListener = undefined;
    sessionCookiesDuringIdentify = "";
    seededInitialPersonProperties = {};
    posthogLifecycle.length = 0;
    init.mockClear();
    capture.mockClear();
    identify.mockClear();
    optInCapturing.mockClear();
    optOutCapturing.mockClear();
    reset.mockClear();
    unregister.mockClear();
    overrideFeatureFlags.mockClear();
    setConfig.mockClear();
    reloadFeatureFlags.mockClear();
    startSessionRecording.mockClear();
    stopSessionRecording.mockClear();
    onSessionId.mockClear();
    getAnalyticsAccountIdentity.mockClear();
    refreshAnalyticsAccountIdentity.mockClear();
    subscribeAnalyticsAccountIdentity.mockClear();
  });

  afterEach(() => {
    cleanup();
    // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to clear consent synchronously.
    document.cookie = "cc_cookie=; Path=/; Max-Age=0";
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("rejects unsafe telemetry hosts before first SDK initialization", async () => {
    const [
      {
        PostHogAnalytics: UnsafeHostPostHogAnalytics,
        PostHogProvider: UnsafeHostPostHogProvider,
      },
      { useFeatureFlagEnabled },
    ] = await Promise.all([
      import("./posthog-analytics?unsafe-host-guard"),
      import("@/features/feature-flags/react"),
    ]);

    const DiscountCodesProbe = ({
      initialEnabled,
    }: {
      readonly initialEnabled: boolean;
    }) => {
      const enabled = useFeatureFlagEnabled("discount_codes", initialEnabled);
      return <>{enabled && <form aria-label="Discount code" />}</>;
    };

    const UnsafeHostAnalyticsBoundary = ({
      analyticsAccepted,
      discountCodesOverride,
    }: {
      readonly analyticsAccepted: boolean;
      readonly discountCodesOverride?: boolean;
    }) => (
      <UnsafeHostPostHogProvider>
        <UnsafeHostPostHogAnalytics
          analyticsAccepted={analyticsAccepted}
          featureFlagOverrides={
            discountCodesOverride === undefined
              ? undefined
              : { discount_codes: discountCodesOverride }
          }
          posthogEnvironment="preview"
        >
          <DiscountCodesProbe initialEnabled />
        </UnsafeHostPostHogAnalytics>
      </UnsafeHostPostHogProvider>
    );

    const distinctIdBeforeHostGuard = currentDistinctId;
    setConsentCookie(["necessary", "analytics"]);
    for (const unsafeHost of [
      "https://deskohub.test/ingest",
      "https://deskohub.test:3211/ingest",
      "https://user:password@telemetry.example/ingest",
    ]) {
      posthogHost = unsafeHost;
      const unsafeView = render(
        <UnsafeHostAnalyticsBoundary analyticsAccepted discountCodesOverride />
      );
      expect(
        unsafeView.getByRole("form", { name: "Discount code" })
      ).toBeDefined();
      unsafeView.unmount();
    }

    expect(init).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
    expect(reloadFeatureFlags).not.toHaveBeenCalled();
    expect(overrideFeatureFlags).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(currentDistinctId).toBe(distinctIdBeforeHostGuard);
  });

  test("requires every consent cookie to accept analytics", async () => {
    const [{ PostHogAnalytics, PostHogProvider }, { useFeatureFlagEnabled }] =
      await Promise.all([
        import("./posthog-analytics?strict-consent-cookie-guard"),
        import("@/features/feature-flags/react"),
      ]);

    const DiscountCodesProbe = ({
      initialEnabled,
    }: {
      readonly initialEnabled: boolean;
    }) => {
      const enabled = useFeatureFlagEnabled("discount_codes", initialEnabled);
      return <>{enabled && <form aria-label="Discount code" />}</>;
    };

    const AnalyticsBoundary = ({
      analyticsAccepted,
    }: {
      readonly analyticsAccepted: boolean;
    }) => (
      <PostHogProvider>
        <PostHogAnalytics
          analyticsAccepted={analyticsAccepted}
          posthogEnvironment="preview"
        >
          <DiscountCodesProbe initialEnabled />
        </PostHogAnalytics>
      </PostHogProvider>
    );

    const analyticsCookie = createConsentCookieString([
      "necessary",
      "analytics",
    ]);
    const nullCategoryCookie = createConsentCookieString([
      "necessary",
      "analytics",
      null,
    ]);
    const reversedNullCategoryCookie = createConsentCookieString([
      null,
      "necessary",
      "analytics",
    ]);
    const unknownCategoryCookie = createConsentCookieString([
      "necessary",
      "analytics",
      "unknown",
    ]);
    const reversedUnknownCategoryCookie = createConsentCookieString([
      "unknown",
      "necessary",
      "analytics",
    ]);
    const invalidCookieStrings = [
      nullCategoryCookie,
      reversedNullCategoryCookie,
      unknownCategoryCookie,
      reversedUnknownCategoryCookie,
      `${analyticsCookie}; ${nullCategoryCookie}`,
      `${nullCategoryCookie}; ${analyticsCookie}`,
      `${analyticsCookie}; ${unknownCategoryCookie}`,
      `${unknownCategoryCookie}; ${analyticsCookie}`,
    ];

    for (const cookieString of invalidCookieStrings) {
      await act(async () => {
        withDocumentCookieString(cookieString, () => {
          const freshView = render(<AnalyticsBoundary analyticsAccepted />);
          freshView.unmount();
        });
      });
    }

    expect(init).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
    expect(reloadFeatureFlags).not.toHaveBeenCalled();
    expect(overrideFeatureFlags).not.toHaveBeenCalled();

    setConsentCookie(["necessary", "analytics"]);
    const view = render(<AnalyticsBoundary analyticsAccepted />);
    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
      });
    });

    const beforeSend = initConfig?.before_send;
    if (!beforeSend || Array.isArray(beforeSend)) {
      throw new Error("The PostHog test client needs a before_send function");
    }
    const necessaryCookie = createConsentCookieString(["necessary"]);
    const invalidConsentCookieStrings = [
      `${analyticsCookie}; ${necessaryCookie}`,
      `${necessaryCookie}; ${analyticsCookie}`,
      `${analyticsCookie}; cc_cookie=not-json`,
      ...invalidCookieStrings,
    ];

    for (const cookieString of invalidConsentCookieStrings) {
      const resetCountBeforeInvalidCookie = reset.mock.calls.length;
      const optOutCountBeforeInvalidCookie = optOutCapturing.mock.calls.length;
      const identifyCountBeforeInvalidCookie = identify.mock.calls.length;
      const reloadCountBeforeInvalidCookie =
        reloadFeatureFlags.mock.calls.length;
      const capturedEventCountBeforeInvalidCookie = capturedEvents.length;

      await act(async () => {
        withDocumentCookieString(cookieString, () => {
          window.dispatchEvent(new Event("focus"));
        });
      });

      expect(reset).toHaveBeenCalledTimes(resetCountBeforeInvalidCookie + 1);
      expect(optOutCapturing).toHaveBeenCalledTimes(
        optOutCountBeforeInvalidCookie + 1
      );
      expect(init).toHaveBeenCalledTimes(1);
      expect(identify).toHaveBeenCalledTimes(identifyCountBeforeInvalidCookie);
      expect(reloadFeatureFlags).toHaveBeenCalledTimes(
        reloadCountBeforeInvalidCookie
      );
      capture("blocked for invalid consent cookies");
      expect(capturedEvents).toHaveLength(
        capturedEventCountBeforeInvalidCookie
      );
      expect(
        beforeSend(createEvent("blocked for invalid consent cookies", {}))
      ).toBeNull();

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(identify).toHaveBeenCalledTimes(
        identifyCountBeforeInvalidCookie + 1
      );
      expect(reloadFeatureFlags).toHaveBeenCalledTimes(
        reloadCountBeforeInvalidCookie + 1
      );
    }

    view.unmount();
  });

  test("keeps initialization, identity, consent, and pageviews ordered", async () => {
    const [{ PostHogAnalytics, PostHogProvider }, { useFeatureFlagEnabled }] =
      await Promise.all([
        import("./posthog-analytics"),
        import("@/features/feature-flags/react"),
      ]);

    const DiscountCodesProbe = ({
      initialEnabled,
    }: {
      readonly initialEnabled: boolean;
    }) => {
      const enabled = useFeatureFlagEnabled("discount_codes", initialEnabled);
      return <>{enabled && <form aria-label="Discount code" />}</>;
    };

    const AnalyticsBoundary = ({
      analyticsAccepted,
      discountCodesOverride,
    }: {
      readonly analyticsAccepted: boolean;
      readonly discountCodesOverride?: boolean;
    }) => (
      <PostHogProvider>
        <PostHogAnalytics
          analyticsAccepted={analyticsAccepted}
          featureFlagOverrides={
            discountCodesOverride === undefined
              ? undefined
              : { discount_codes: discountCodesOverride }
          }
          posthogEnvironment="preview"
        >
          <DiscountCodesProbe initialEnabled />
        </PostHogAnalytics>
      </PostHogProvider>
    );

    seededInitialPersonProperties = {
      $initial_campaign_params: "synthetic-legacy-utm",
      $initial_person_info: "synthetic-old-url",
      $initial_referrer_info: "synthetic-referrer",
    };
    posthogLifecycle.length = 0;
    const anonymousDistinctIdBeforeInitialization = currentDistinctId;

    const view = render(
      <AnalyticsBoundary analyticsAccepted={false} discountCodesOverride />
    );

    expect(view.getByRole("form", { name: "Discount code" })).toBeDefined();
    expect(init).not.toHaveBeenCalled();
    expect(overrideFeatureFlags).not.toHaveBeenCalled();
    expect(subscribeAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);

    setConsentCookie(["necessary", "analytics"]);
    await act(async () => {
      view.rerender(
        <AnalyticsBoundary analyticsAccepted discountCodesOverride />
      );
    });

    expect(init).toHaveBeenCalledTimes(1);
    expect(initConfig).toEqual(
      expect.objectContaining({
        advanced_disable_feature_flags: true,
        advanced_disable_feature_flags_on_first_load: true,
        capture_pageleave: false,
        capture_pageview: false,
        tracing_headers: [],
      })
    );
    expect(seededInitialPersonProperties).toEqual({});
    expect(posthogLifecycle.slice(0, 4)).toEqual([
      "init",
      "unregister:$initial_person_info",
      "unregister:$initial_referrer_info",
      "unregister:$initial_campaign_params",
    ]);
    expect(currentDistinctId).toBe(anonymousDistinctIdBeforeInitialization);
    expect(reset).not.toHaveBeenCalled();
    expect(reloadFeatureFlags).not.toHaveBeenCalled();
    expect(overrideFeatureFlags).toHaveBeenLastCalledWith({
      flags: { discount_codes: true },
    });

    const beforeSend = initConfig?.before_send;
    if (!beforeSend || Array.isArray(beforeSend)) {
      throw new Error("The PostHog test client needs a before_send function");
    }
    expect(beforeSend(createEvent("blocked while pending", {}))).toBeNull();

    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "unavailable" });
    });
    expect(beforeSend(createEvent("blocked while unavailable", {}))).toBeNull();

    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
      });
    });

    expect(identify).toHaveBeenCalledWith("workspace-account:account-a");
    expect(posthogLifecycle.slice(4)).toEqual([
      "identify",
      "unregister:$initial_person_info",
      "unregister:$initial_referrer_info",
      "unregister:$initial_campaign_params",
      "enable-feature-flags",
      "reload-feature-flags",
    ]);
    expect(unregister).toHaveBeenCalledTimes(6);
    expect(seededInitialPersonProperties).toEqual({});
    expect(capturedEvents.map(({ event }) => event)).toEqual([
      "$identify",
      "$pageview",
    ]);
    expect(sessionCookiesDuringIdentify).toContain(
      "dh_ph_session_id=session-before-ready"
    );
    expect(document.cookie).toContain(
      "dh_ph_distinct_id=workspace-account%3Aaccount-a"
    );
    expect(document.cookie).toContain("dh_ph_session_id=session-id");
    expect(setConfig).toHaveBeenLastCalledWith({
      advanced_disable_feature_flags: false,
      tracing_headers: [window.location.hostname],
    });
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(1);
    expect(startSessionRecording).not.toHaveBeenCalled();

    analyticsAccountIdentity = {
      accountId: "account-b",
      status: "authenticated",
    };
    expect(
      beforeSend(
        createEvent("stale account A after fresh account B snapshot", {
          distinct_id: "workspace-account:account-a",
        })
      )
    ).toBeNull();
    analyticsAccountIdentity = {
      accountId: "account-a",
      status: "authenticated",
    };

    const eventCount = capturedEvents.length;
    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
      });
    });
    expect(identify).toHaveBeenCalledTimes(1);
    expect(capturedEvents).toHaveLength(eventCount);

    pathname = "/settings";
    await act(async () => {
      view.rerender(<AnalyticsBoundary analyticsAccepted />);
    });
    expect(capturedEvents.map(({ event }) => event)).toEqual([
      "$identify",
      "$pageview",
      "$pageview",
    ]);
    expect(overrideFeatureFlags).toHaveBeenLastCalledWith(false);

    sessionIdListener?.("session-after-navigation");
    expect(document.cookie).toContain(
      "dh_ph_session_id=session-after-navigation"
    );

    const resetCountBeforeCookieRemoval = reset.mock.calls.length;
    clearConsentCookie();
    expect(
      beforeSend(createEvent("blocked after cookie removal", {}))
    ).toBeNull();
    window.dispatchEvent(new Event("focus"));
    expect(reset).toHaveBeenCalledTimes(resetCountBeforeCookieRemoval + 1);
    expect(optOutCapturing).toHaveBeenCalled();

    setConsentCookie(["necessary"]);
    window.dispatchEvent(
      new CustomEvent(CONSENT_UPDATED_EVENT, {
        detail: { _tag: "ConsentUpdated", acceptedCategories: ["necessary"] },
      })
    );
    expect(document.cookie).not.toContain(
      "dh_ph_distinct_id=workspace-account%3Aaccount-a"
    );
    expect(document.cookie).not.toContain("dh_ph_session_id=session-id");
    expect(setConfig).toHaveBeenLastCalledWith({
      advanced_disable_feature_flags: true,
      tracing_headers: [],
    });
    expect(stopSessionRecording).toHaveBeenCalled();
    expect(beforeSend(createEvent("blocked after withdrawal", {}))).toBeNull();
    sessionIdListener?.("session-while-paused");
    expect(document.cookie).not.toContain("session-while-paused");

    const reloadCountBeforeCookieLessGrant =
      reloadFeatureFlags.mock.calls.length;
    clearConsentCookie();
    window.dispatchEvent(
      new CustomEvent(CONSENT_UPDATED_EVENT, {
        detail: {
          _tag: "ConsentUpdated",
          acceptedCategories: ["necessary", "analytics"],
        },
      })
    );
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(
      reloadCountBeforeCookieLessGrant
    );
    expect(
      beforeSend(createEvent("blocked without consent cookie", {}))
    ).toBeNull();

    const refreshCountBeforeReconsent =
      refreshAnalyticsAccountIdentity.mock.calls.length;
    setConsentCookie(["necessary", "analytics"]);
    window.dispatchEvent(
      new CustomEvent(CONSENT_UPDATED_EVENT, {
        detail: {
          _tag: "ConsentUpdated",
          acceptedCategories: ["necessary", "analytics"],
        },
      })
    );
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(
      refreshCountBeforeReconsent + 1
    );
    window.dispatchEvent(new Event("focus"));

    await act(async () => {
      view.rerender(<AnalyticsBoundary analyticsAccepted />);
    });
    expect(
      capturedEvents.filter(({ event }) => event === "$pageview")
    ).toHaveLength(3);

    const resetCountBeforeUnmount = reset.mock.calls.length;
    const optOutCountBeforeUnmount = optOutCapturing.mock.calls.length;
    const identifyCountBeforeUnmount = identify.mock.calls.length;
    const pageviewCountBeforeUnmount = capturedEvents.filter(
      ({ event }) => event === "$pageview"
    ).length;
    view.unmount();

    expect(
      beforeSend(createEvent("blocked after observer unmount", {}))
    ).toBeNull();
    expect(document.cookie).not.toContain(
      "dh_ph_distinct_id=workspace-account%3Aaccount-a"
    );
    expect(document.cookie).not.toContain("dh_ph_session_id=session-id");
    expect(setConfig).toHaveBeenLastCalledWith({
      advanced_disable_feature_flags: true,
      tracing_headers: [],
    });
    expect(reset).toHaveBeenCalledTimes(resetCountBeforeUnmount);
    expect(optOutCapturing).toHaveBeenCalledTimes(optOutCountBeforeUnmount);
    expect(currentDistinctId).toBe("workspace-account:account-a");

    setConsentCookie(["necessary", "analytics"]);
    const remountedView = render(<AnalyticsBoundary analyticsAccepted />);
    expect(identify).toHaveBeenCalledTimes(identifyCountBeforeUnmount);
    expect(reset).toHaveBeenCalledTimes(resetCountBeforeUnmount);
    expect(
      capturedEvents.filter(({ event }) => event === "$pageview")
    ).toHaveLength(pageviewCountBeforeUnmount);
    expect(document.cookie).toContain(
      "dh_ph_distinct_id=workspace-account%3Aaccount-a"
    );

    const resetCountBeforeRemovedCookieUnmount = reset.mock.calls.length;
    const optOutCountBeforeRemovedCookieUnmount =
      optOutCapturing.mock.calls.length;
    clearConsentCookie();
    remountedView.unmount();
    expect(reset).toHaveBeenCalledTimes(
      resetCountBeforeRemovedCookieUnmount + 1
    );
    expect(optOutCapturing).toHaveBeenCalledTimes(
      optOutCountBeforeRemovedCookieUnmount + 1
    );

    analyticsAccountIdentity = {
      accountId: "account-b",
      status: "authenticated",
    };
    setConsentCookie(["necessary", "analytics"]);
    const switchedAccountView = render(<AnalyticsBoundary analyticsAccepted />);
    expect(reset).toHaveBeenCalledTimes(resetCountBeforeUnmount + 1);
    expect(identify).toHaveBeenLastCalledWith("workspace-account:account-b");
    expect(document.cookie).toContain(
      "dh_ph_distinct_id=workspace-account%3Aaccount-b"
    );
    expect(
      capturedEvents.filter(({ event }) => event === "$pageview")
    ).toHaveLength(pageviewCountBeforeUnmount + 1);

    const resetCountBeforeUnsafeHost = reset.mock.calls.length;
    const optOutCountBeforeUnsafeHost = optOutCapturing.mock.calls.length;
    const reloadCountBeforeUnsafeHost = reloadFeatureFlags.mock.calls.length;
    posthogHost = "https://deskohub.test/ingest";
    await act(async () => {
      switchedAccountView.rerender(<AnalyticsBoundary analyticsAccepted />);
    });
    expect(reset).toHaveBeenCalledTimes(resetCountBeforeUnsafeHost + 1);
    expect(optOutCapturing).toHaveBeenCalledTimes(
      optOutCountBeforeUnsafeHost + 1
    );
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(
      reloadCountBeforeUnsafeHost
    );
    expect(setConfig).toHaveBeenLastCalledWith({
      advanced_disable_feature_flags: true,
      tracing_headers: [],
    });
    expect(document.cookie).not.toContain(
      "dh_ph_distinct_id=workspace-account%3Aaccount-b"
    );
    expect(document.cookie).not.toContain("dh_ph_session_id=session-id");
    expect(
      beforeSend(createEvent("blocked after unsafe host change", {}))
    ).toBeNull();

    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-b",
        status: "authenticated",
      });
    });
    expect(reset).toHaveBeenCalledTimes(resetCountBeforeUnsafeHost + 1);
    expect(optOutCapturing).toHaveBeenCalledTimes(
      optOutCountBeforeUnsafeHost + 1
    );
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(
      reloadCountBeforeUnsafeHost
    );
    switchedAccountView.unmount();
  });

  test("synchronizes consent across tabs before restoring fresh identity", async () => {
    const { PostHogAnalytics, PostHogProvider } = await import(
      "./posthog-analytics?cross-tab-consent"
    );

    const AnalyticsBoundary = () => (
      <PostHogProvider>
        <PostHogAnalytics analyticsAccepted posthogEnvironment="preview">
          <p>synthetic analytics content</p>
        </PostHogAnalytics>
      </PostHogProvider>
    );

    setConsentCookie(["necessary", "analytics"]);
    const view = render(<AnalyticsBoundary />);
    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
      });
    });

    const beforeSend = initConfig?.before_send;
    if (!beforeSend || Array.isArray(beforeSend)) {
      throw new Error("The PostHog test client needs a before_send function");
    }
    expect(identify).toHaveBeenLastCalledWith("workspace-account:account-a");

    const identifyCountBeforeWithdrawal = identify.mock.calls.length;
    const reloadCountBeforeWithdrawal = reloadFeatureFlags.mock.calls.length;
    const resetCountBeforeWithdrawal = reset.mock.calls.length;
    const optOutCountBeforeWithdrawal = optOutCapturing.mock.calls.length;
    window.localStorage.setItem(CONSENT_UPDATED_STORAGE_KEY, "sentinel");

    setConsentCookie(["necessary"]);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CONSENT_UPDATED_STORAGE_KEY,
        newValue: "synthetic-withdrawal-nonce",
      })
    );

    expect(reset).toHaveBeenCalledTimes(resetCountBeforeWithdrawal + 1);
    expect(optOutCapturing).toHaveBeenCalledTimes(
      optOutCountBeforeWithdrawal + 1
    );
    expect(identify).toHaveBeenCalledTimes(identifyCountBeforeWithdrawal);
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(
      reloadCountBeforeWithdrawal
    );
    expect(setConfig).toHaveBeenLastCalledWith({
      advanced_disable_feature_flags: true,
      tracing_headers: [],
    });
    expect(window.localStorage.getItem(CONSENT_UPDATED_STORAGE_KEY)).toBe(
      "sentinel"
    );
    expect(beforeSend(createEvent("blocked after remote withdrawal", {}))).toBe(
      null
    );

    refreshedAnalyticsAccountIdentity = {
      accountId: "account-b",
      status: "authenticated",
    };
    setConsentCookie(["necessary", "analytics"]);
    const refreshCountBeforeReconsent =
      refreshAnalyticsAccountIdentity.mock.calls.length;
    const identifyCountBeforeReconsent = identify.mock.calls.length;
    const reloadCountBeforeReconsent = reloadFeatureFlags.mock.calls.length;
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CONSENT_UPDATED_STORAGE_KEY,
        newValue: "synthetic-reconsent-nonce",
      })
    );

    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(
      refreshCountBeforeReconsent + 1
    );
    expect(identify).toHaveBeenCalledTimes(identifyCountBeforeReconsent);
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(
      reloadCountBeforeReconsent
    );
    expect(
      beforeSend(createEvent("blocked while identity refreshes", {}))
    ).toBe(null);

    await act(async () => {
      await Promise.resolve();
    });

    expect(identify).toHaveBeenCalledTimes(identifyCountBeforeReconsent + 1);
    expect(identify).toHaveBeenLastCalledWith("workspace-account:account-b");
    expect(reloadFeatureFlags).toHaveBeenCalledTimes(
      reloadCountBeforeReconsent + 1
    );
    expect(setConfig).toHaveBeenLastCalledWith({
      advanced_disable_feature_flags: false,
      tracing_headers: [window.location.hostname],
    });
    expect(window.localStorage.getItem(CONSENT_UPDATED_STORAGE_KEY)).toBe(
      "sentinel"
    );

    const refreshCountBeforeFocus =
      refreshAnalyticsAccountIdentity.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(
      refreshCountBeforeFocus
    );

    view.unmount();
  });

  test("builds a privacy-safe production configuration", async () => {
    const { createPostHogConfig, isPostHogTelemetryHostAllowed } = await import(
      "../utils/posthog-config"
    );
    const beforeSend: BeforeSendFn = (event) => event;
    const config = createPostHogConfig({
      apiHost: "https://posthog.example",
      beforeSend,
      optOutUseragentFilter: false,
    });

    expect(
      isPostHogTelemetryHostAllowed(
        "https://posthog.example/ingest",
        "deskohub.test"
      )
    ).toBe(true);
    expect(
      isPostHogTelemetryHostAllowed(
        "https://deskohub.test/ingest",
        "deskohub.test"
      )
    ).toBe(false);
    expect(
      isPostHogTelemetryHostAllowed(
        "https://DESKOHUB.TEST./ingest",
        "deskohub.test"
      )
    ).toBe(false);
    expect(
      isPostHogTelemetryHostAllowed(
        "https://deskohub.test/ingest",
        "DESKOHUB.TEST."
      )
    ).toBe(false);
    expect(
      isPostHogTelemetryHostAllowed(
        "https://deskohub.test:3211/ingest",
        "deskohub.test"
      )
    ).toBe(false);
    expect(
      isPostHogTelemetryHostAllowed(
        "https://user:password@posthog.example/ingest",
        "deskohub.test"
      )
    ).toBe(false);
    expect(isPostHogTelemetryHostAllowed("/ingest", "deskohub.test")).toBe(
      false
    );
    expect(isPostHogTelemetryHostAllowed("http://.", "deskohub.test")).toBe(
      false
    );
    expect(
      isPostHogTelemetryHostAllowed(
        "ftp://posthog.example/ingest",
        "deskohub.test"
      )
    ).toBe(false);

    expect(config).toMatchObject({
      advanced_disable_feature_flags: true,
      advanced_disable_feature_flags_on_first_load: true,
      autocapture: false,
      capture_exceptions: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_pageleave: false,
      capture_pageview: false,
      disable_capture_url_hashes: true,
      disable_session_recording: true,
      disable_surveys: true,
      mask_all_text: true,
      rageclick: false,
      save_campaign_params: false,
      save_referrer: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "body",
        recordBody: false,
        recordHeaders: false,
      },
      tracing_headers: [],
    });
    expect(config.mask_all_element_attributes).toBeUndefined();
    expect(config.session_recording.maskAllElementAttributes).toBeUndefined();

    const maskCapturedNetworkRequestFn =
      config.session_recording.maskCapturedNetworkRequestFn;
    if (!maskCapturedNetworkRequestFn) {
      throw new Error("The production config needs network URL masking");
    }

    const request: CapturedNetworkRequest = {
      duration: 1,
      entryType: "resource",
      name: "https://deskohub.test/account?email=synthetic%40example.test#secret",
      requestBody: "synthetic-request-body",
      requestHeaders: { authorization: "synthetic-token" },
      responseBody: "synthetic-response-body",
      responseHeaders: { "x-private": "synthetic-header" },
      startTime: 0,
    };
    const maskedRequest = maskCapturedNetworkRequestFn(request);

    expect(maskedRequest).toMatchObject({
      name: "https://deskohub.test/account",
      requestBody: undefined,
      requestHeaders: undefined,
      responseBody: undefined,
      responseHeaders: undefined,
    });
    expect(JSON.stringify(maskedRequest)).not.toContain("synthetic");
  });
});
