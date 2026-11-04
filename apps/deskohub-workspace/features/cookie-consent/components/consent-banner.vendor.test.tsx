import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  CONSENT_COOKIE_NAME,
  getAcceptedConsentCategoriesFromCookie,
} from "@/shared/utils/consent-cookie";

// Other suites replace vanilla-cookieconsent with fakes in this process, so
// bind the real library through its file path.
const vendorPath = "vanilla-cookieconsent/dist/cookieconsent.esm.js";
const vendor: typeof import("vanilla-cookieconsent") = await import(vendorPath);
mock.module("vanilla-cookieconsent", () => vendor);

const { CONSENT_UPDATED_STORAGE_KEY, visitorConsent } = await import(
  "../visitor-consent"
);
const { ConsentBanner } = await import("./consent-banner");

const accepted = () => getAcceptedConsentCategoriesFromCookie(document.cookie);

// Another tab of the same browser rewrites the shared cookie and pings.
function changeConsentInAnotherTab(categories: readonly string[]) {
  const cookie = vendor.getCookie();
  // biome-ignore lint/suspicious/noDocumentCookie: The test plays another tab writing the shared consent cookie.
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify({ ...cookie, categories })
  )}; Path=/; Domain=${location.hostname}`;
  window.dispatchEvent(
    new StorageEvent("storage", { key: CONSENT_UPDATED_STORAGE_KEY })
  );
}

const consentEvents = () =>
  (window.dataLayer ?? []).filter(
    (entry) => !Array.isArray(entry) || entry[0] === "consent"
  );

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  window.happyDOM.setURL("https://deskohub.test/en-US");
  window.dataLayer = [];
  window.gtag = undefined;
});
afterEach(() => {
  cleanup();
  vendor.reset(true);
});
afterAll(unregisterWorkspaceComponentTestEnv);

test("a withdrawal in a tab that remembers the withdrawn state persists and denies Google consent", async () => {
  const view = render(<ConsentBanner locale="en-US" />);
  await act(async () => {
    vendor.acceptCategory([]);
    await flushMicrotasks();
  });
  expect(accepted()).toEqual(["necessary"]);
  // A locale change re-runs the banner effect while the vendor stays
  // initialized.
  view.rerender(<ConsentBanner locale="cs-CZ" />);

  changeConsentInAnotherTab(["necessary", "analytics"]);
  expect(visitorConsent.accepts("analytics")).toBe(true);
  expect(consentEvents().at(-3)).toEqual([
    "consent",
    "update",
    { analytics_storage: "granted" },
  ]);

  window.dataLayer = [];
  await act(async () => {
    visitorConsent.reject("analytics");
    await flushMicrotasks();
  });

  expect(accepted()).toEqual(["necessary"]);
  expect(consentEvents()).toEqual([
    ["consent", "update", { analytics_storage: "denied" }],
    [
      "consent",
      "update",
      {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ],
    ["consent", "update", { personalization_storage: "denied" }],
    { event: "consent_update" },
  ]);
});

test("a vendor-saved change keeps the existing update and event sequence", async () => {
  render(<ConsentBanner locale="en-US" />);
  await act(async () => {
    vendor.acceptCategory([]);
    await flushMicrotasks();
  });

  window.dataLayer = [];
  await act(async () => {
    visitorConsent.accept("marketing");
    await flushMicrotasks();
  });

  expect(accepted()).toEqual(["necessary", "marketing"]);
  expect(consentEvents()).toEqual([
    ["consent", "update", { analytics_storage: "denied" }],
    [
      "consent",
      "update",
      {
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
      },
    ],
    ["consent", "update", { personalization_storage: "denied" }],
    { event: "consent_update" },
  ]);
});
