import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import type { CheckoutStatusKind } from "@/features/checkout/checkout-status-kind";
import {
  type AnalyticsEvent,
  deliverAnalyticsEvents,
  discardAnalyticsEvents,
} from "@/features/cookie-consent/analytics-events";
import {
  announceVisitorConsentChange,
  bindVisitorConsentRevision,
} from "@/features/cookie-consent/visitor-consent";
import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import { savedConsentCookieValue } from "@/shared/testing/consent-cookie.test-utils";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutStatusAnalytics } from "./checkout-status-analytics";

const setConsentCookie = (categories: readonly string[]) => {
  // biome-ignore lint/suspicious/noDocumentCookie: The test controls the consent cookie the analytics boundary reads.
  document.cookie = `cc_cookie=${savedConsentCookieValue({ categories })}; Path=/`;
};

const page = (status: CheckoutStatusKind) => (
  <StrictMode>
    <CheckoutStatusAnalytics status={status} />
  </StrictMode>
);

let events: AnalyticsEvent[] = [];
let detach: (() => void) | undefined;

describe("CheckoutStatusAnalytics", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    bindVisitorConsentRevision(getConsentBannerRevision());
    window.happyDOM.setURL("https://deskohub.test/en-US/reservation/status/x");
    events = [];
    detach = deliverAnalyticsEvents((event) => {
      events.push(event);
    });
  });

  afterEach(() => {
    cleanup();
    detach?.();
    detach = undefined;
    discardAnalyticsEvents();
    // biome-ignore lint/suspicious/noDocumentCookie: The test clears consent between cases.
    document.cookie = "cc_cookie=; Path=/; Max-Age=0";
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("captures each status the page shows once, however often polling refreshes it", () => {
    setConsentCookie(["necessary", "analytics"]);

    const view = render(page("pending"));
    view.rerender(page("pending"));
    view.rerender(page("pending"));
    view.rerender(page("paid_waiting_fulfillment"));
    view.rerender(page("fulfilled"));
    view.rerender(page("fulfilled"));

    expect(events).toEqual([
      { event: "checkout status viewed", properties: { status: "pending" } },
      {
        event: "checkout status viewed",
        properties: { status: "paid_waiting_fulfillment" },
      },
      { event: "checkout status viewed", properties: { status: "fulfilled" } },
    ]);
  });

  test("captures again on a new page visit", () => {
    setConsentCookie(["necessary", "analytics"]);

    render(page("fulfilled")).unmount();
    render(page("fulfilled"));

    expect(events.map(({ properties }) => properties)).toEqual([
      { status: "fulfilled" },
      { status: "fulfilled" },
    ]);
  });

  test("captures the shown status once the visitor consents", () => {
    setConsentCookie(["necessary"]);
    const view = render(page("fulfilled"));
    expect(events).toEqual([]);

    setConsentCookie(["necessary", "analytics"]);
    act(() => announceVisitorConsentChange());
    view.rerender(page("fulfilled"));

    expect(events).toEqual([
      { event: "checkout status viewed", properties: { status: "fulfilled" } },
    ]);
  });

  test("captures nothing without analytics consent", () => {
    setConsentCookie(["necessary"]);

    const view = render(page("pending"));
    view.rerender(page("fulfilled"));

    expect(events).toEqual([]);
  });
});
