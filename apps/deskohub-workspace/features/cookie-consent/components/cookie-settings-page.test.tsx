import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const acceptCategory = mock((_category: string) => undefined);
const rejectCategory = mock((_category: string) => undefined);
let acceptedCategories: readonly string[] = ["necessary"];
const isAccepted = mock((category: string) =>
  acceptedCategories.includes(category)
);

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ acceptCategory, rejectCategory, isAccepted }),
}));

import { CookieSettings } from "./cookie-settings-page";

const switchRole = (category: string) =>
  ({
    necessary: "Necessary cookies",
    analytics: "Analytics cookies",
    marketing: "Marketing cookies",
    preferences: "Preference cookies",
  })[category];

const getSwitch = (view: ReturnType<typeof render>, category: string) =>
  view.getByRole("switch", { name: switchRole(category) });

describe("CookieSettings", () => {
  beforeEach(() => {
    registerWorkspaceComponentTestEnv();
    window.happyDOM.setURL("https://deskohub.test/cookies");
    acceptedCategories = ["necessary"];
    acceptCategory.mockClear();
    rejectCategory.mockClear();
    acceptCategory.mockImplementation(() => undefined);
    rejectCategory.mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    unregisterWorkspaceComponentTestEnv();
  });

  test("keeps the necessary switch checked and disabled without calling the consent hook", () => {
    const view = render(<CookieSettings locale="en-US" />);

    const necessarySwitch = getSwitch(view, "necessary");
    expect(necessarySwitch.getAttribute("aria-checked")).toBe("true");
    expect(necessarySwitch.hasAttribute("disabled")).toBe(true);
    expect(necessarySwitch.getAttribute("aria-describedby")).toBe(
      "cookie-category-necessary-description"
    );

    fireEvent.click(necessarySwitch);
    expect(acceptCategory).not.toHaveBeenCalled();
    expect(rejectCategory).not.toHaveBeenCalled();
  });

  test("locks a pending optional switch until the deferred save settles", async () => {
    let releaseAccept: (() => void) | undefined;
    acceptCategory.mockImplementation(
      (_category: string) =>
        new Promise<void>((resolve) => {
          releaseAccept = resolve;
        })
    );

    const view = render(<CookieSettings locale="en-US" />);
    const analyticsSwitch = getSwitch(view, "analytics");
    const marketingSwitch = getSwitch(view, "marketing");

    fireEvent.click(analyticsSwitch);

    expect(analyticsSwitch.hasAttribute("disabled")).toBe(true);
    expect(marketingSwitch.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      await Promise.resolve();
    });
    expect(acceptCategory).toHaveBeenCalledWith("analytics");

    await act(async () => {
      releaseAccept?.();
    });

    expect(analyticsSwitch.hasAttribute("disabled")).toBe(false);
    expect(marketingSwitch.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      fireEvent.click(marketingSwitch);
    });
    expect(acceptCategory).toHaveBeenCalledWith("marketing");
  });

  test("saves each optional category immediately through its own accept and reject action", async () => {
    acceptedCategories = ["necessary", "marketing"];
    const view = render(<CookieSettings locale="en-US" />);

    await act(async () => {
      fireEvent.click(getSwitch(view, "analytics"));
    });
    expect(acceptCategory).toHaveBeenCalledWith("analytics");
    expect(rejectCategory).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(getSwitch(view, "marketing"));
    });
    expect(rejectCategory).toHaveBeenCalledWith("marketing");
    expect(acceptCategory).toHaveBeenCalledTimes(1);
  });

  test("reports a failed save accessibly and re-enables the switch", async () => {
    acceptedCategories = ["necessary", "analytics"];
    rejectCategory.mockImplementation(() => {
      throw new Error("synthetic save failure");
    });

    const view = render(<CookieSettings locale="en-US" />);
    expect(view.queryByRole("alert")).toBeNull();

    await act(async () => {
      fireEvent.click(getSwitch(view, "analytics"));
    });

    expect(rejectCategory).toHaveBeenCalledWith("analytics");
    expect(view.getByRole("alert").textContent).toContain(
      "Something went wrong"
    );
    expect(getSwitch(view, "analytics").hasAttribute("disabled")).toBe(false);
  });

  test("renders exactly the four category row articles without a group wrapper", () => {
    const view = render(<CookieSettings locale="en-US" />);

    // CookieSettings owns only its four row articles; composing them into a
    // preference-row group is the caller's presentation decision.
    const group = view.container.querySelector(
      '[data-slot="preference-row-group"]'
    );
    expect(group).toBeNull();

    const rows = view.container.querySelectorAll(
      '[data-slot="preference-row"]'
    );
    expect(rows).toHaveLength(4);
    // Peer headings: the rows carry h3 titles, not h2.
    for (const row of rows) {
      expect(row.querySelector("h2")).toBeNull();
      expect(row.querySelector("h3")).toBeTruthy();
    }
  });
});
