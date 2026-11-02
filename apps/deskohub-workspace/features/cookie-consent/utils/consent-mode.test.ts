import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  denyMarketingConsent,
  grantAnalyticsConsent,
  initializeConsentMode,
  pushConsentUpdateEvent,
} from "./consent-mode";

test("does nothing without a browser window", () => {
  expect(globalThis.window).toBeUndefined();
  expect(() => {
    pushConsentUpdateEvent();
    initializeConsentMode();
    grantAnalyticsConsent();
  }).not.toThrow();
});

describe("in a browser", () => {
  beforeEach(() => {
    registerWorkspaceComponentTestEnv();
    window.dataLayer = undefined;
    window.gtag = undefined;
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("pushes the consent update event onto a new data layer", () => {
    pushConsentUpdateEvent();

    expect(window.dataLayer).toEqual([{ event: "consent_update" }]);
  });

  test("appends the consent update event to an existing data layer", () => {
    window.dataLayer = [{ event: "gtm.js" }];

    pushConsentUpdateEvent();

    expect(window.dataLayer).toEqual([
      { event: "gtm.js" },
      { event: "consent_update" },
    ]);
  });

  test("queues the denied defaults and later updates through gtag", () => {
    initializeConsentMode();
    grantAnalyticsConsent();
    denyMarketingConsent();

    const commands = (window.dataLayer ?? []).map((entry) =>
      Array.from(entry as ArrayLike<unknown>)
    );
    expect(commands).toEqual([
      [
        "consent",
        "default",
        expect.objectContaining({
          analytics_storage: "denied",
          ad_storage: "denied",
          security_storage: "granted",
        }),
      ],
      ["consent", "update", { analytics_storage: "granted" }],
      [
        "consent",
        "update",
        {
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
    ]);
  });

  test("keeps an already installed gtag", () => {
    const calls: unknown[][] = [];
    window.gtag = (...args: unknown[]) => {
      calls.push(args);
    };

    grantAnalyticsConsent();

    expect(calls).toEqual([
      ["consent", "update", { analytics_storage: "granted" }],
    ]);
    expect(window.dataLayer).toEqual([]);
  });
});
