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
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CONSENT_COOKIE_NAME } from "@/shared/utils/consent-cookie";
import { CONSENT_UPDATED_STORAGE_KEY } from "../utils/consent-event";

let preferenceCategories: string[] = ["necessary"];

mock.module("vanilla-cookieconsent", () => ({
  // vanilla-cookieconsent 3.1.0 replaces the complete accepted set; a string
  // argument is stored as a single-element list.
  acceptCategory: mock((categories: string | string[]) => {
    preferenceCategories = Array.isArray(categories)
      ? [...categories]
      : [categories];
  }),
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
