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
  CaptureLogOptions,
  CaptureResult,
  PostHogConfig,
} from "posthog-js";
import { runWorkspaceBrowserEffect } from "@/shared/browser/workspace-browser-effect";
import {
  discardWorkspaceBrowserLogs,
  reportWorkspaceBrowserFailure,
} from "@/shared/browser/workspace-browser-logs";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  captureAnalyticsEvent,
  discardAnalyticsEvents,
} from "../analytics-events";
import {
  CONSENT_UPDATED_EVENT,
  CONSENT_UPDATED_STORAGE_KEY,
} from "../utils/consent-event";

process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://posthog.example";
let posthogHost = "https://posthog.example";

mock.module("@/client-env", () => ({
  getClientEnv: () => ({
    NEXT_PUBLIC_POSTHOG_HOST: posthogHost,
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
  }),
}));

type TestAnalyticsAccountIdentity =
  | { readonly status: "pending" | "unavailable" | "anonymous" }
  | {
      readonly accountId: string;
      readonly status: "authenticated";
      readonly testAccount?: boolean;
    };

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

const dotyposCustomerIds = new Map<string, string>();
const dotyposCustomerIdListeners = new Set<() => void>();
const linkDotyposCustomer = (accountId: string, dotyposCustomerId: string) => {
  dotyposCustomerIds.set(accountId, dotyposCustomerId);
  for (const listener of [...dotyposCustomerIdListeners]) listener();
};
const requestAnalyticsDotyposCustomerId = mock(
  (_accountId: string) => undefined
);

mock.module("@/features/account/analytics-customer-link", () => ({
  getAnalyticsDotyposCustomerId: (accountId: string) =>
    dotyposCustomerIds.get(accountId),
  requestAnalyticsDotyposCustomerId,
  subscribeAnalyticsDotyposCustomerId: (listener: () => void) => {
    dotyposCustomerIdListeners.add(listener);
    return () => dotyposCustomerIdListeners.delete(listener);
  },
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
const captureLog = mock((_options: CaptureLogOptions) => undefined);
const identify = mock((distinctId?: string) => {
  posthogLifecycle.push("identify");
  if (distinctId !== undefined) currentDistinctId = distinctId;
  currentUserState = "identified";
  sessionIdListener?.("session-before-ready");
  sessionCookiesDuringIdentify = document.cookie;
  capture("$identify");
});
const setInternalOrTestUser = mock(() => {
  posthogLifecycle.push("set-internal-or-test-user");
  capture("$set", { $set: { $internal_or_test_user: true } });
});
const setPersonProperties = mock((properties: Record<string, string>) => {
  capture("$set", { $set: properties });
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
  captureLog,
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
  setInternalOrTestUser,
  setPersonProperties,
  startSessionRecording,
  stopSessionRecording,
  unregister,
};

mock.module("posthog-js", () => ({ default: posthog }));

const preloadableModule = await import("@/shared/utils/preloadable-module");
const { createPreloadableModule, useLoadedModule, usePreloadWhenIdle } =
  preloadableModule;
let failNextSdkLoad = false;
mock.module("@/shared/utils/preloadable-module", () => ({
  createPreloadableModule: <Module,>(importModule: () => Promise<Module>) =>
    createPreloadableModule(() => {
      if (!failNextSdkLoad) return importModule();
      failNextSdkLoad = false;
      return Promise.reject(new Error("synthetic chunk load failure"));
    }),
  useLoadedModule,
  usePreloadWhenIdle,
}));

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
    captureLog.mockClear();
    identify.mockClear();
    setInternalOrTestUser.mockClear();
    setPersonProperties.mockClear();
    dotyposCustomerIds.clear();
    dotyposCustomerIdListeners.clear();
    requestAnalyticsDotyposCustomerId.mockClear();
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

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
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
    // The unsafe-host matrix lives in utils/posthog-config.test.ts; one
    // same-origin host proves the component honours the guard.
    posthogHost = "https://deskohub.test/ingest";
    const unsafeView = render(
      <UnsafeHostAnalyticsBoundary analyticsAccepted discountCodesOverride />
    );
    expect(
      unsafeView.getByRole("form", { name: "Discount code" })
    ).toBeDefined();
    unsafeView.unmount();

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

  test("marks only a consented production test account as an internal or test user", async () => {
    const { PostHogAnalytics, PostHogProvider } = await import(
      "./posthog-analytics?test-account-tagging"
    );
    const AnalyticsBoundary = ({
      analyticsAccepted,
    }: {
      readonly analyticsAccepted: boolean;
    }) => (
      <PostHogProvider>
        <PostHogAnalytics
          analyticsAccepted={analyticsAccepted}
          posthogEnvironment="production"
        />
      </PostHogProvider>
    );

    setConsentCookie(["necessary", "analytics"]);
    const view = render(<AnalyticsBoundary analyticsAccepted />);
    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
        testAccount: false,
      });
    });

    expect(identify).toHaveBeenCalledWith("workspace-account:account-a");
    expect(setInternalOrTestUser).not.toHaveBeenCalled();

    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-b",
        status: "authenticated",
        testAccount: true,
      });
    });

    expect(identify).toHaveBeenLastCalledWith("workspace-account:account-b");
    expect(setInternalOrTestUser).toHaveBeenCalledTimes(1);
    const personEvent = capturedEvents.find(({ event }) => event === "$set");
    expect(personEvent?.properties).toMatchObject({
      $set: { $internal_or_test_user: true },
      "deployment.environment.name": "production",
      distinct_id: "workspace-account:account-b",
    });

    view.unmount();
  });

  test("tags preview events and marks every preview account as an internal or test user", async () => {
    const { PostHogAnalytics, PostHogProvider } = await import(
      "./posthog-analytics?preview-environment-tagging"
    );

    setConsentCookie(["necessary", "analytics"]);
    const view = render(
      <PostHogProvider>
        <PostHogAnalytics analyticsAccepted posthogEnvironment="preview" />
      </PostHogProvider>
    );
    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
        testAccount: false,
      });
    });
    capture("reservation started");

    expect(setInternalOrTestUser).toHaveBeenCalledTimes(1);
    for (const eventName of ["$identify", "$set", "reservation started"]) {
      const event = capturedEvents.find(({ event }) => event === eventName);
      expect(event?.properties).toMatchObject({
        "deployment.environment.name": "preview",
        distinct_id: "workspace-account:account-a",
      });
    }

    view.unmount();
  });

  test("links a consented account's person to its Dotypos customer ID once it loads", async () => {
    const { PostHogAnalytics, PostHogProvider } = await import(
      "./posthog-analytics?dotypos-customer-link"
    );
    const AnalyticsBoundary = ({
      analyticsAccepted,
    }: {
      readonly analyticsAccepted: boolean;
    }) => (
      <PostHogProvider>
        <PostHogAnalytics
          analyticsAccepted={analyticsAccepted}
          posthogEnvironment="preview"
        />
      </PostHogProvider>
    );

    setConsentCookie(["necessary"]);
    const view = render(<AnalyticsBoundary analyticsAccepted={false} />);
    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
        testAccount: false,
      });
    });

    expect(requestAnalyticsDotyposCustomerId).not.toHaveBeenCalled();

    setConsentCookie(["necessary", "analytics"]);
    view.rerender(<AnalyticsBoundary analyticsAccepted />);
    await act(async () => undefined);

    expect(identify).toHaveBeenCalledWith("workspace-account:account-a");
    expect(requestAnalyticsDotyposCustomerId).toHaveBeenCalledWith("account-a");
    expect(setPersonProperties).not.toHaveBeenCalled();

    await act(async () => {
      linkDotyposCustomer("account-a", "customer-a");
    });

    expect(identify).toHaveBeenCalledTimes(1);
    expect(setPersonProperties).toHaveBeenCalledTimes(1);
    // Preview also marks the person as internal or test with its own $set.
    const personEvent = capturedEvents.find(
      ({ event, properties }) =>
        event === "$set" && properties.$set?.dotypos_customer_id !== undefined
    );
    expect(personEvent?.properties).toMatchObject({
      $set: { dotypos_customer_id: "customer-a" },
      distinct_id: "workspace-account:account-a",
    });
    expect(Object.keys(personEvent?.properties.$set ?? {})).toEqual([
      "dotypos_customer_id",
    ]);

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
          posthogEnvironment="production"
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

  test("delivers browser logs once each, only while analytics is ready", async () => {
    const { PostHogAnalytics, PostHogProvider } = await import(
      "./posthog-analytics?browser-logs"
    );
    const logBrowserFailure = (failureCode: string) =>
      act(async () => {
        await reportWorkspaceBrowserFailure(
          failureCode,
          new Error("synthetic browser failure")
        ).pipe(runWorkspaceBrowserEffect("test.browser-logs"));
      });
    const deliveredLog = (failureCode: string): CaptureLogOptions => ({
      attributes: {
        boundary: "browser",
        "deployment.environment.name": "preview",
        errorType: "Error",
        failureCode,
        operation: "test.browser-logs",
        "url.full": "https://deskohub.test/account",
      },
      body: "Workspace browser failure",
      level: "warn",
    });

    discardWorkspaceBrowserLogs();
    window.happyDOM.setURL(
      "https://deskohub.test/account?checkoutToken=synthetic-token#hash"
    );
    setConsentCookie(["necessary", "analytics"]);
    const view = render(
      <PostHogProvider>
        <PostHogAnalytics analyticsAccepted posthogEnvironment="preview">
          <p>synthetic analytics content</p>
        </PostHogAnalytics>
      </PostHogProvider>
    );

    await logBrowserFailure("test.before-ready");
    expect(captureLog).not.toHaveBeenCalled();

    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
      });
    });
    expect(captureLog.mock.calls).toEqual([
      [deliveredLog("test.before-ready")],
    ]);

    await logBrowserFailure("test.while-ready");
    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "unavailable" });
    });
    await logBrowserFailure("test.while-paused");
    expect(captureLog.mock.calls).toEqual([
      [deliveredLog("test.before-ready")],
      [deliveredLog("test.while-ready")],
    ]);

    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
      });
    });
    expect(captureLog.mock.calls).toEqual([
      [deliveredLog("test.before-ready")],
      [deliveredLog("test.while-ready")],
      [deliveredLog("test.while-paused")],
    ]);

    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "pending" });
    });
    await logBrowserFailure("test.before-withdrawal");
    setConsentCookie(["necessary"]);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CONSENT_UPDATED_STORAGE_KEY,
        newValue: "synthetic-withdrawal-nonce",
      })
    );
    setConsentCookie(["necessary", "analytics"]);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CONSENT_UPDATED_STORAGE_KEY,
        newValue: "synthetic-reconsent-nonce",
      })
    );
    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
      });
    });

    expect(captureLog).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(captureLog.mock.calls)).not.toContain(
      "synthetic-token"
    );

    view.unmount();
  });

  test("keeps consented events captured before the consent state hydrates", async () => {
    const { PostHogAnalytics, PostHogProvider } = await import(
      "./posthog-analytics?consent-hydration"
    );
    const AnalyticsBoundary = ({
      analyticsAccepted,
    }: {
      readonly analyticsAccepted: boolean;
    }) => (
      <PostHogProvider>
        <PostHogAnalytics
          analyticsAccepted={analyticsAccepted}
          posthogEnvironment="preview"
        />
      </PostHogProvider>
    );

    discardAnalyticsEvents();
    setConsentCookie(["necessary", "analytics"]);
    captureAnalyticsEvent("before hydration");
    const view = render(<AnalyticsBoundary analyticsAccepted={false} />);
    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "anonymous" });
    });
    await act(async () => {
      view.rerender(<AnalyticsBoundary analyticsAccepted />);
    });

    expect(capturedEvents.map(({ event }) => event)).toContain(
      "before hydration"
    );

    view.unmount();
  });

  test("retries a failed SDK load when the tab regains focus", async () => {
    const { PostHogAnalytics, PostHogProvider } = await import(
      "./posthog-analytics?sdk-load-retry"
    );

    discardAnalyticsEvents();
    setConsentCookie(["necessary", "analytics"]);
    failNextSdkLoad = true;
    const view = render(
      <PostHogProvider>
        <PostHogAnalytics analyticsAccepted posthogEnvironment="preview" />
      </PostHogProvider>
    );
    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "anonymous" });
    });
    captureAnalyticsEvent("while the SDK failed to load");
    expect(init).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(init).toHaveBeenCalledTimes(1);
    expect(capturedEvents.map(({ event }) => event)).toContain(
      "while the SDK failed to load"
    );

    view.unmount();
  });

  test("drops events held from an account that is left before the SDK loads", async () => {
    const { PostHogAnalytics, PostHogProvider } = await import(
      "./posthog-analytics?account-change-before-load"
    );

    discardAnalyticsEvents();
    setConsentCookie(["necessary", "analytics"]);
    const view = render(
      <PostHogProvider>
        <PostHogAnalytics analyticsAccepted posthogEnvironment="preview" />
      </PostHogProvider>
    );
    publishAnalyticsAccountIdentity({
      accountId: "account-a",
      status: "authenticated",
    });
    captureAnalyticsEvent("from account a");
    publishAnalyticsAccountIdentity({ status: "pending" });
    publishAnalyticsAccountIdentity({ status: "anonymous" });
    captureAnalyticsEvent("after leaving account a");
    expect(init).not.toHaveBeenCalled();

    await act(async () => undefined);

    expect(init).toHaveBeenCalledTimes(1);
    const eventNames = capturedEvents.map(({ event }) => event);
    expect(eventNames).not.toContain("from account a");
    expect(eventNames).toContain("after leaving account a");

    view.unmount();
  });

  test("sends events captured before the SDK loads once analytics is ready", async () => {
    const { PostHogAnalytics, PostHogProvider } = await import(
      "./posthog-analytics?analytics-events"
    );
    const AnalyticsBoundary = ({
      analyticsAccepted,
    }: {
      readonly analyticsAccepted: boolean;
    }) => (
      <PostHogProvider>
        <PostHogAnalytics
          analyticsAccepted={analyticsAccepted}
          posthogEnvironment="preview"
        />
      </PostHogProvider>
    );
    const capturedEventNames = () =>
      capturedEvents
        .map(({ event }) => event)
        .filter((event) => event !== "$identify" && event !== "$set");

    discardAnalyticsEvents();
    setConsentCookie(["necessary"]);
    const view = render(<AnalyticsBoundary analyticsAccepted={false} />);
    captureAnalyticsEvent("without consent");
    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "anonymous" });
    });
    expect(init).not.toHaveBeenCalled();

    setConsentCookie(["necessary", "analytics"]);
    captureAnalyticsEvent("before load", { step: 1 });
    captureAnalyticsEvent("before load", { step: 2 });
    expect(init).not.toHaveBeenCalled();

    await act(async () => {
      view.rerender(<AnalyticsBoundary analyticsAccepted />);
    });
    expect(init).toHaveBeenCalledTimes(1);
    expect(capturedEventNames()).toEqual([
      "$pageview",
      "before load",
      "before load",
    ]);
    expect(
      capturedEvents
        .filter(({ event }) => event === "before load")
        .map(({ properties }) => properties.step)
    ).toEqual([1, 2]);

    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "pending" });
    });
    captureAnalyticsEvent("while paused");
    expect(capturedEventNames()).not.toContain("while paused");
    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "anonymous" });
    });
    expect(capturedEventNames().at(-1)).toBe("while paused");

    await act(async () => {
      publishAnalyticsAccountIdentity({
        accountId: "account-a",
        status: "authenticated",
      });
    });
    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "pending" });
    });
    captureAnalyticsEvent("while leaving account a");
    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "anonymous" });
    });
    expect(capturedEventNames()).not.toContain("while leaving account a");

    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "pending" });
    });
    captureAnalyticsEvent("before withdrawal");
    setConsentCookie(["necessary"]);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CONSENT_UPDATED_STORAGE_KEY,
        newValue: "synthetic-withdrawal-nonce",
      })
    );
    captureAnalyticsEvent("after withdrawal");
    setConsentCookie(["necessary", "analytics"]);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CONSENT_UPDATED_STORAGE_KEY,
        newValue: "synthetic-reconsent-nonce",
      })
    );
    await act(async () => {
      publishAnalyticsAccountIdentity({ status: "anonymous" });
    });

    expect(capturedEventNames()).not.toContain("without consent");
    expect(capturedEventNames()).not.toContain("before withdrawal");
    expect(capturedEventNames()).not.toContain("after withdrawal");

    view.unmount();
  });
});
