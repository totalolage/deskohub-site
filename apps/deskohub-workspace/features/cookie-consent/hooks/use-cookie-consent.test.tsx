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
import { useLayoutEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CONSENT_COOKIE_NAME } from "@/shared/utils/consent-cookie";
import { CONSENT_UPDATED_STORAGE_KEY } from "../utils/consent-event";

let preferenceCategories: string[] = ["necessary"];

const acceptCategoryMock = mock((categories: string | string[]) => {
  preferenceCategories = Array.isArray(categories)
    ? [...categories]
    : [categories];
});

mock.module("vanilla-cookieconsent", () => ({
  // vanilla-cookieconsent 3.1.0 replaces the complete accepted set; a string
  // argument is stored as a single-element list.
  acceptCategory: acceptCategoryMock,
  acceptedCategory: (category: string) =>
    preferenceCategories.includes(category),
  getUserPreferences: () => ({ acceptedCategories: preferenceCategories }),
  showPreferences: mock(() => undefined),
}));

const { useCookieConsent } = await import("./use-cookie-consent");

const setConsentCookie = (categories: string[]) => {
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to control consent synchronously.
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify({ categories })
  )}; Path=/`;
};

function ConsentProbe() {
  const { acceptedCategories, isAccepted } = useCookieConsent();

  return (
    <output data-testid="consent-state">
      {acceptedCategories.join(",")}|
      {isAccepted("analytics") ? "true" : "false"}
    </output>
  );
}

function ConsentToggle() {
  const { acceptedCategories, isAccepted } = useCookieConsent();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isAccepted("analytics")}
      data-testid="consent-toggle"
    >
      {acceptedCategories.join(",")}
    </button>
  );
}

type Hook = ReturnType<typeof useCookieConsent>;
let latest: Hook | undefined;

function HookHarness() {
  const value = useCookieConsent();

  // Capture after each committed render; assigning during render would
  // violate the react-hooks rules for rendering purity.
  useLayoutEffect(() => {
    latest = value;
  });

  return null;
}

const renderHook = () => {
  const view = render(<HookHarness />);

  return { view, current: () => latest! };
};

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  window.happyDOM.setURL("https://deskohub.test/account");
  preferenceCategories = ["necessary"];
  setConsentCookie(["necessary"]);
  acceptCategoryMock.mockClear();
});
afterEach(() => {
  cleanup();
  // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to clear consent synchronously.
  document.cookie = `${CONSENT_COOKIE_NAME}=; Path=/; Max-Age=0`;
  window.localStorage.removeItem(CONSENT_UPDATED_STORAGE_KEY);
});
afterAll(unregisterWorkspaceComponentTestEnv);

test("reads the current cookie instead of cached preferences after storage notification", async () => {
  const view = render(<ConsentProbe />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(view.getByTestId("consent-state").textContent).toBe("necessary|false");

  setConsentCookie(["necessary", "analytics"]);
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CONSENT_UPDATED_STORAGE_KEY,
        newValue: "synthetic-consent-nonce",
      })
    );
  });

  expect(view.getByTestId("consent-state").textContent).toBe(
    "necessary,analytics|true"
  );
});

test("accepting a category deduplicates it into the authoritative preferences", () => {
  const { current } = renderHook();

  act(() => current().acceptCategory("analytics"));
  expect(preferenceCategories).toEqual(["necessary", "analytics"]);

  act(() => current().acceptCategory("analytics"));
  expect(preferenceCategories).toEqual(["necessary", "analytics"]);
});

test("accepting categories in sequence preserves earlier accepts and necessary", () => {
  const { current } = renderHook();

  act(() => current().acceptCategory("analytics"));
  act(() => current().acceptCategory("marketing"));

  expect(preferenceCategories).toEqual(["necessary", "analytics", "marketing"]);
});

test("rejecting a category keeps the other accepted categories", () => {
  preferenceCategories = ["necessary", "analytics", "marketing"];
  const { current } = renderHook();

  act(() => current().rejectCategory("analytics"));

  expect(preferenceCategories).toEqual(["necessary", "marketing"]);
});

test("rejecting necessary is a no-op", () => {
  preferenceCategories = ["necessary", "analytics"];
  const { current } = renderHook();

  act(() => current().rejectCategory("necessary"));

  expect(preferenceCategories).toEqual(["necessary", "analytics"]);
});

test("accepting necessary preserves the other accepted categories", () => {
  preferenceCategories = ["necessary", "analytics"];
  const { current } = renderHook();

  act(() => current().acceptCategory("necessary"));

  expect(preferenceCategories).toEqual(["necessary", "analytics"]);
});

test("actions preserve authoritative state changed while the hook snapshot was stale", () => {
  const { current } = renderHook();
  expect(preferenceCategories).toEqual(["necessary"]);

  // Another tab updated consent without notifying this document; the React
  // snapshot stays stale while the provider state is authoritative.
  preferenceCategories = ["necessary", "analytics"];

  act(() => current().acceptCategory("marketing"));
  expect(preferenceCategories).toEqual(["necessary", "analytics", "marketing"]);

  act(() => current().rejectCategory("analytics"));
  expect(preferenceCategories).toEqual(["necessary", "marketing"]);
});

test("callback identities stay stable across rerenders", () => {
  const { view, current } = renderHook();
  const before = current();

  view.rerender(<HookHarness />);

  const after = current();
  expect(after.acceptAll).toBe(before.acceptAll);
  expect(after.rejectAll).toBe(before.rejectAll);
  expect(after.showPreferences).toBe(before.showPreferences);
  expect(after.acceptCategory).toBe(before.acceptCategory);
  expect(after.rejectCategory).toBe(before.rejectCategory);
  expect(after.isAccepted).toBe(before.isAccepted);
});

test("hydrates with markup matching the server render when consent cookies exist", async () => {
  setConsentCookie(["necessary", "analytics"]);
  // The consent provider (vanilla-cookieconsent) has loaded its state in the
  // browser; the cookie mirrors it.
  preferenceCategories = ["necessary", "analytics"];
  const cookieBefore = document.cookie;

  const serverMarkup = renderToString(<ConsentToggle />);
  // The server has no consent provider state, so the first markup must not
  // claim analytics acceptance.
  expect(serverMarkup).toContain('aria-checked="false"');
  expect(serverMarkup).not.toContain("analytics");

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
        // React schedules hydration and the hook's post-mount sync through
        // timers; happyDOM's task manager drains them here, inside act.
        await window.happyDOM?.waitUntilComplete?.();
        // Drain the hook's deferred post-provider-init sync timer too.
        await new Promise((resolve) => window.setTimeout(resolve, 1));
        // Let the React scheduler deliver the update queued by that sync.
        await new Promise((resolve) => setTimeout(resolve, 10));
        await window.happyDOM?.waitUntilComplete?.();
      });

      expect(consoleErrors).toEqual([]);

      const toggle = container.querySelector("[data-testid=consent-toggle]")!;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(toggle.textContent).toBe("necessary,analytics");

      // Mounting must not write consent; only reads and React state sync.
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
