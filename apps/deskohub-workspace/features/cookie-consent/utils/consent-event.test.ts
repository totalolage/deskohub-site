import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  CONSENT_UPDATED_EVENT,
  CONSENT_UPDATED_STORAGE_KEY,
  dispatchConsentUpdatedEvent,
} from "./consent-event";

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(() => window.localStorage.removeItem(CONSENT_UPDATED_STORAGE_KEY));
afterAll(unregisterWorkspaceComponentTestEnv);

describe("dispatchConsentUpdatedEvent", () => {
  test("dispatches locally and stores only a nonce for other tabs", () => {
    let receivedCategories: string[] | undefined;
    const handleConsentUpdated = (
      event: WindowEventMap[typeof CONSENT_UPDATED_EVENT]
    ) => {
      receivedCategories = event.detail.acceptedCategories;
    };
    window.addEventListener(CONSENT_UPDATED_EVENT, handleConsentUpdated);

    dispatchConsentUpdatedEvent(["necessary", "analytics"]);

    expect(receivedCategories).toEqual(["necessary", "analytics"]);
    const nonce = window.localStorage.getItem(CONSENT_UPDATED_STORAGE_KEY);
    expect(nonce).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(nonce).not.toContain("necessary");
    expect(nonce).not.toContain("analytics");

    window.removeEventListener(CONSENT_UPDATED_EVENT, handleConsentUpdated);
  });
});
