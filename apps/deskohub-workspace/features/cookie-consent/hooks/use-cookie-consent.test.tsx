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
import { CONSENT_COOKIE_NAME } from "@/shared/utils/consent-cookie";
import { CONSENT_UPDATED_STORAGE_KEY } from "../utils/consent-event";

let preferenceCategories: string[] = ["necessary"];

mock.module("vanilla-cookieconsent", () => ({
  acceptCategory: mock(() => undefined),
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
