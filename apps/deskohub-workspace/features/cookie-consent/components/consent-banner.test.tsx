import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CONSENT_COOKIE_NAME } from "@/shared/utils/consent-cookie";

type ConsentCallbacks = {
  readonly onConsent: () => void;
  readonly onChange: () => void;
  readonly onFirstConsent: () => void;
};

let callbacks: ConsentCallbacks | undefined;
let bannerShows = 0;

mock.module("vanilla-cookieconsent", () => ({
  acceptCategory: () => undefined,
  run: (config: ConsentCallbacks) => {
    callbacks = config;
    // The vendor renders its banner root for an ordinary browser.
    if (!document.getElementById("cc-main")) {
      document.body.append(
        Object.assign(document.createElement("div"), { id: "cc-main" })
      );
    }
    return Promise.resolve();
  },
  show: () => {
    bannerShows += 1;
  },
  hide: () => undefined,
}));

mock.module("@/features/account/analytics-identity", () => ({
  getAnalyticsAccountIdentity: () => ({ status: "anonymous" }),
  subscribeAnalyticsAccountIdentity: () => () => undefined,
}));

const resolveSilentAnalyticsGrantForDevice = mock(() =>
  Promise.resolve({ data: null })
);
mock.module("@/features/legal/actions", () => ({
  recordDeviceAnalyticsConsent: () => Promise.resolve({ data: false }),
  resolveSilentAnalyticsGrantForDevice,
}));
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: () => Promise<{ readonly data: string | null }>
  ) => ({
    execute: () => void action(),
    executeAsync: action,
  }),
}));

// The banner revision the page is served with in these tests.
const revision = 7;

const { CONSENT_UPDATED_EVENT, CONSENT_UPDATED_STORAGE_KEY } = await import(
  "../visitor-consent"
);
const { ConsentBanner } = await import("./consent-banner");

function setConsentCookie(
  categories: readonly string[],
  savedRevision = revision
) {
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to control consent synchronously.
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify({ categories, revision: savedRevision })
  )}; Path=/`;
}

const consentUpdates = () =>
  (window.dataLayer ?? [])
    .filter(
      (entry): entry is unknown[] =>
        Array.isArray(entry) && entry[0] === "consent"
    )
    .map((entry) => [entry[1], entry[2]]);

const deniedUpdates = [
  ["update", { analytics_storage: "denied" }],
  [
    "update",
    {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    },
  ],
  ["update", { personalization_storage: "denied" }],
];

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

let order: string[] = [];
const recordAppEvent = () => order.push("app event");

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  window.happyDOM.setURL("https://deskohub.test/en-US");
  callbacks = undefined;
  bannerShows = 0;
  resolveSilentAnalyticsGrantForDevice.mockClear();
  order = [];
  window.dataLayer = [];
  window.gtag = undefined;
  window.addEventListener(CONSENT_UPDATED_EVENT, recordAppEvent);
});
afterEach(() => {
  cleanup();
  document.getElementById("cc-main")?.remove();
  window.removeEventListener(CONSENT_UPDATED_EVENT, recordAppEvent);
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to clear consent synchronously.
  document.cookie = `${CONSENT_COOKIE_NAME}=; Path=/; Max-Age=0`;
});
afterAll(unregisterWorkspaceComponentTestEnv);

test("denies Google consent by default before any consent and announces without a tag manager event", async () => {
  render(<ConsentBanner locale="en-US" revision={revision} />);
  await flushMicrotasks();

  expect(consentUpdates()).toEqual([
    [
      "default",
      {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
        functionality_storage: "granted",
        personalization_storage: "denied",
        security_storage: "granted",
      },
    ],
    ...deniedUpdates,
  ]);
  expect(window.dataLayer).not.toContainEqual({ event: "consent_update" });
  expect(order).toEqual(["app event"]);
});

test("a change grants each accepted category, then fires the app event before the queued consent_update", async () => {
  render(<ConsentBanner locale="en-US" revision={revision} />);
  await flushMicrotasks();
  window.dataLayer = [];
  order = [];

  setConsentCookie(["necessary", "analytics", "preferences"]);
  callbacks?.onChange();
  const dataLayer = window.dataLayer;
  dataLayer.push = (...entries: unknown[]) => {
    for (const entry of entries) {
      if (!Array.isArray(entry)) order.push(JSON.stringify(entry));
    }
    return Array.prototype.push.apply(dataLayer, entries);
  };
  await flushMicrotasks();

  expect(consentUpdates()).toEqual([
    ["update", { analytics_storage: "granted" }],
    deniedUpdates[1],
    ["update", { personalization_storage: "granted" }],
  ]);
  expect(order).toEqual(["app event", '{"event":"consent_update"}']);
});

test("first consent queues consent_update; a restored consent does not", async () => {
  render(<ConsentBanner locale="en-US" revision={revision} />);
  await flushMicrotasks();
  setConsentCookie(["necessary", "marketing"]);

  window.dataLayer = [];
  callbacks?.onConsent();
  await flushMicrotasks();
  expect(window.dataLayer).not.toContainEqual({ event: "consent_update" });

  window.dataLayer = [];
  callbacks?.onFirstConsent();
  await flushMicrotasks();
  expect(consentUpdates()[1]).toEqual([
    "update",
    {
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    },
  ]);
  expect(window.dataLayer.at(-1)).toEqual({ event: "consent_update" });
});

test("a malformed duplicate consent cookie keeps Google consent denied", async () => {
  setConsentCookie(["necessary", "analytics", "marketing", "preferences"]);
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs a second cookie copy on another path.
  document.cookie = `${CONSENT_COOKIE_NAME}=not-json; Path=/en-US`;

  try {
    render(<ConsentBanner locale="en-US" revision={revision} />);
    await flushMicrotasks();

    expect(consentUpdates().slice(1)).toEqual(deniedUpdates);
  } finally {
    // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to remove the second copy synchronously; happy-dom keeps an emptied copy after Max-Age=0.
    document.cookie = `${CONSENT_COOKIE_NAME}=; Path=/en-US; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
});

test("another tab's withdrawal reaches Google consent mode without re-announcing", async () => {
  setConsentCookie(["necessary", "analytics"]);
  render(<ConsentBanner locale="en-US" revision={revision} />);
  await flushMicrotasks();
  window.dataLayer = [];
  order = [];
  const nonce = window.localStorage.getItem(CONSENT_UPDATED_STORAGE_KEY);

  window.dispatchEvent(new Event("focus"));
  expect(window.dataLayer).toEqual([]);

  setConsentCookie(["necessary"]);
  window.dispatchEvent(
    new StorageEvent("storage", { key: CONSENT_UPDATED_STORAGE_KEY })
  );
  window.dispatchEvent(new Event("focus"));
  await flushMicrotasks();

  expect(consentUpdates()).toEqual(deniedUpdates);
  expect(window.dataLayer).not.toContainEqual({ event: "consent_update" });
  expect(order).toEqual([]);
  expect(window.localStorage.getItem(CONSENT_UPDATED_STORAGE_KEY)).toBe(nonce);
});

test("a consent cookie saved under an earlier revision keeps Google consent denied and opens the banner without asking the account", async () => {
  setConsentCookie(["necessary", "analytics", "marketing", "preferences"], 0);

  render(<ConsentBanner locale="en-US" revision={revision} />);
  await flushMicrotasks();

  expect(consentUpdates().slice(1)).toEqual(deniedUpdates);
  expect(bannerShows).toBe(1);
  expect(resolveSilentAnalyticsGrantForDevice).not.toHaveBeenCalled();
});

test("a device with a choice under the current revision never opens the banner", async () => {
  setConsentCookie(["necessary"]);

  render(<ConsentBanner locale="en-US" revision={revision} />);
  await flushMicrotasks();

  expect(bannerShows).toBe(0);
});
