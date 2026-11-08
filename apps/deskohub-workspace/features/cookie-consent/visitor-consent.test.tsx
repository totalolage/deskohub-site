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
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CONSENT_COOKIE_NAME } from "@/shared/utils/consent-cookie";

// What this tab's vanilla-cookieconsent remembers; it never sees other tabs.
let rememberedCategories: string[] = ["necessary"];
let preferenceCategories: string[] = ["necessary"];

// vanilla-cookieconsent 3.1.0 replaces the complete accepted set (always
// keeping the read-only necessary category) and saves it to the consent
// cookie only when it differs from the set it remembers.
const acceptCategoryMock = mock((categories: string | string[]) => {
  const requested = [
    ...new Set([
      "necessary",
      ...(Array.isArray(categories) ? categories : [categories]),
    ]),
  ];
  const unchanged =
    requested.length === rememberedCategories.length &&
    requested.every((category) => rememberedCategories.includes(category));
  if (unchanged) return;
  rememberedCategories = requested;
  preferenceCategories = requested;
  setConsentCookie(requested);
});

// setCookieData rewrites the whole remembered cookie value.
const setCookieDataMock = mock(() => {
  preferenceCategories = [...rememberedCategories];
  setConsentCookie(rememberedCategories);
  return true;
});

mock.module("vanilla-cookieconsent", () => ({
  acceptCategory: acceptCategoryMock,
  getCookie: () => null,
  getUserPreferences: () => ({ acceptedCategories: rememberedCategories }),
  hide: () => undefined,
  setCookieData: setCookieDataMock,
  validConsent: () => true,
}));

const {
  CONSENT_UPDATED_EVENT,
  CONSENT_UPDATED_STORAGE_KEY,
  announceVisitorConsentChange,
  bindVisitorConsentRevision,
  useVisitorConsent,
  visitorConsent,
} = await import("./visitor-consent");

// The banner revision the page was served with in these tests.
const revision = 7;

function setConsentCookie(categories: string[], savedRevision = revision) {
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to control consent synchronously.
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify({ categories, revision: savedRevision })
  )}; Path=/`;
}

function ConsentProbe() {
  return (
    <output data-testid="consent-state">
      {useVisitorConsent("analytics") ? "true" : "false"}
    </output>
  );
}

function ConsentToggle() {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={useVisitorConsent("analytics")}
      data-testid="consent-toggle"
    />
  );
}

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  bindVisitorConsentRevision(revision);
  window.happyDOM.setURL("https://deskohub.test/account");
  rememberedCategories = ["necessary"];
  preferenceCategories = ["necessary"];
  setConsentCookie(["necessary"]);
  acceptCategoryMock.mockClear();
  setCookieDataMock.mockClear();
});
afterEach(() => {
  cleanup();
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to clear consent synchronously.
  document.cookie = `${CONSENT_COOKIE_NAME}=; Path=/; Max-Age=0`;
  window.localStorage.removeItem(CONSENT_UPDATED_STORAGE_KEY);
});
afterAll(unregisterWorkspaceComponentTestEnv);

test("reads the current cookie after another tab signals a change", async () => {
  const view = render(<ConsentProbe />);
  expect(view.getByTestId("consent-state").textContent).toBe("false");

  setConsentCookie(["necessary", "analytics"]);
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CONSENT_UPDATED_STORAGE_KEY,
        newValue: "synthetic-consent-nonce",
      })
    );
  });

  expect(view.getByTestId("consent-state").textContent).toBe("true");
});

test("a withdrawal announced in this tab reaches subscribers at once", async () => {
  setConsentCookie(["necessary", "analytics"]);
  const view = render(<ConsentProbe />);
  expect(view.getByTestId("consent-state").textContent).toBe("true");

  setConsentCookie(["necessary"]);
  await act(async () => announceVisitorConsentChange());

  expect(view.getByTestId("consent-state").textContent).toBe("false");
});

test("a malformed duplicate consent cookie reads as declined", () => {
  setConsentCookie(["necessary", "analytics"]);
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs a second cookie copy on another path.
  document.cookie = `${CONSENT_COOKIE_NAME}=not-json; Path=/account`;

  expect(visitorConsent.accepts("analytics")).toBe(false);
  expect(visitorConsent.accepts("necessary")).toBe(false);

  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to remove the second copy synchronously; happy-dom keeps an emptied copy after Max-Age=0.
  document.cookie = `${CONSENT_COOKIE_NAME}=; Path=/account; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
});

test("subscribers learn where a change was noticed until they unsubscribe", () => {
  const changes: string[] = [];
  const unsubscribe = visitorConsent.subscribe((change) =>
    changes.push(change)
  );

  announceVisitorConsentChange();
  window.dispatchEvent(
    new StorageEvent("storage", { key: CONSENT_UPDATED_STORAGE_KEY })
  );
  window.dispatchEvent(new StorageEvent("storage", { key: "other-key" }));
  window.dispatchEvent(new Event("focus"));
  unsubscribe();
  announceVisitorConsentChange();
  window.dispatchEvent(new Event("focus"));

  expect(changes).toEqual(["local", "other-tab", "focus"]);
});

test("an announcement carries the strict categories and signals other tabs", () => {
  setConsentCookie(["necessary", "analytics"]);
  const details: unknown[] = [];
  const recordDetail = (event: WindowEventMap["consentUpdated"]) =>
    details.push(event.detail);
  window.addEventListener(CONSENT_UPDATED_EVENT, recordDetail);

  try {
    announceVisitorConsentChange();
  } finally {
    window.removeEventListener(CONSENT_UPDATED_EVENT, recordDetail);
  }

  expect(details).toEqual([
    {
      _tag: "ConsentUpdated",
      acceptedCategories: ["necessary", "analytics"],
      change: "local",
    },
  ]);
  const nonce = window.localStorage.getItem(CONSENT_UPDATED_STORAGE_KEY);
  expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
  announceVisitorConsentChange();
  expect(window.localStorage.getItem(CONSENT_UPDATED_STORAGE_KEY)).not.toBe(
    nonce
  );
});

test("a choice saved under an earlier banner revision counts as none until the visitor chooses again", () => {
  setConsentCookie(["necessary", "analytics"], 0);

  expect(visitorConsent.hasChoice()).toBe(false);
  expect(visitorConsent.accepts("analytics")).toBe(false);
  expect(visitorConsent.acceptedCategories()).toEqual([]);

  setConsentCookie(["necessary", "analytics"]);

  expect(visitorConsent.hasChoice()).toBe(true);
  expect(visitorConsent.accepts("analytics")).toBe(true);
});

test("toggles start from the shared cookie, not this tab's stale state", () => {
  // Another tab granted analytics without notifying this document; this
  // tab's library memory stays stale while the cookie is authoritative.
  setConsentCookie(["necessary", "analytics"]);

  visitorConsent.accept("marketing");
  expect(preferenceCategories).toEqual(["necessary", "analytics", "marketing"]);

  visitorConsent.reject("analytics");
  expect(preferenceCategories).toEqual(["necessary", "marketing"]);

  visitorConsent.reject("necessary");
  expect(acceptCategoryMock).toHaveBeenCalledTimes(2);
  expect(setCookieDataMock).not.toHaveBeenCalled();
});

test("a withdrawal persists when this tab still remembers the withdrawn state", () => {
  const changes: string[] = [];
  const unsubscribe = visitorConsent.subscribe((change) =>
    changes.push(change)
  );
  // This tab remembers only necessary; another tab then granted analytics.
  setConsentCookie(["necessary", "analytics"]);

  try {
    visitorConsent.reject("analytics");
  } finally {
    unsubscribe();
  }

  expect(visitorConsent.accepts("analytics")).toBe(false);
  expect(setCookieDataMock).toHaveBeenCalledTimes(1);
  expect(changes).toEqual(["local"]);
});

test("a grant persists when this tab still remembers the granted state", () => {
  rememberedCategories = ["necessary", "analytics"];
  // Another tab withdrew analytics since this tab saved it.
  setConsentCookie(["necessary"]);

  visitorConsent.accept("analytics");

  expect(visitorConsent.accepts("analytics")).toBe(true);
  expect(setCookieDataMock).toHaveBeenCalledTimes(1);
});

test("hydrates with markup matching the server render when consent cookies exist", async () => {
  setConsentCookie(["necessary", "analytics"]);
  const cookieBefore = document.cookie;

  const serverMarkup = renderToString(<ConsentToggle />);
  // The server cannot read the visitor's consent, so the first markup must
  // not claim analytics acceptance.
  expect(serverMarkup).toContain('aria-checked="false"');

  const consoleErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args);
  };

  try {
    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.appendChild(container);

    let root: ReturnType<typeof hydrateRoot> | undefined;

    try {
      root = hydrateRoot(container, <ConsentToggle />);

      await act(async () => {
        // React schedules hydration and the post-hydration snapshot through
        // timers; happyDOM's task manager drains them here, inside act.
        await window.happyDOM?.waitUntilComplete?.();
        await new Promise((resolve) => setTimeout(resolve, 10));
        await window.happyDOM?.waitUntilComplete?.();
      });

      expect(consoleErrors).toEqual([]);

      const toggle = container.querySelector("[data-testid=consent-toggle]")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");

      // Mounting must not write consent; it only reads the cookie.
      expect(acceptCategoryMock).not.toHaveBeenCalled();
      expect(document.cookie).toBe(cookieBefore);
    } finally {
      // Always unmount inside act and drain every queued task before the
      // container and DOM globals are cleaned up, including assertion errors.
      if (root) {
        const mountedRoot = root;
        await act(async () => {
          mountedRoot.unmount();
          await window.happyDOM?.waitUntilComplete?.();
          await new Promise((resolve) => setTimeout(resolve, 10));
          await window.happyDOM?.waitUntilComplete?.();
        });
      }
      container.remove();
    }
  } finally {
    console.error = originalConsoleError;
  }
});
