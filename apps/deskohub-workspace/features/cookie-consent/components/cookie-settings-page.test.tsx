import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/i18n";
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
  useVisitorConsent: isAccepted,
  visitorConsent: { accept: acceptCategory, reject: rejectCategory },
}));

import { CookieSettings } from "./cookie-settings-page";

const categoryMessages = {
  necessary: {
    title: m.cookieSettingsNecessaryTitle,
    description: m.cookieSettingsNecessaryDescription,
  },
  analytics: {
    title: m.cookieSettingsAnalyticsTitle,
    description: m.cookieSettingsAnalyticsDescription,
  },
  marketing: {
    title: m.cookieSettingsMarketingTitle,
    description: m.cookieSettingsMarketingDescription,
  },
  preferences: {
    title: m.cookieSettingsPreferencesTitle,
    description: m.cookieSettingsPreferencesDescription,
  },
} as const;

const getSwitch = (
  view: ReturnType<typeof render>,
  category: keyof typeof categoryMessages
) =>
  view.getByRole("switch", {
    name: categoryMessages[category].title({}, { locale: "en-US" }),
  });

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

  afterEach(async () => {
    cleanup();
    await unregisterWorkspaceComponentTestEnv();
  });

  test("keeps the necessary switch checked and disabled without calling the consent hook", () => {
    const view = render(<CookieSettings locale="en-US" />);

    const necessarySwitch = getSwitch(view, "necessary");
    expect(necessarySwitch.getAttribute("aria-checked")).toBe("true");
    expect(necessarySwitch.hasAttribute("disabled")).toBe(true);
    const descriptionId = necessarySwitch.getAttribute("aria-describedby");
    expect(
      descriptionId && document.getElementById(descriptionId)?.textContent
    ).toBe(m.cookieSettingsNecessaryDescription({}, { locale: "en-US" }));

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
    expect(view.getByRole("alert").textContent).toBe(
      m.errorPageTitle({}, { locale: "en-US" })
    );
    expect(getSwitch(view, "analytics").hasAttribute("disabled")).toBe(false);
  });
});
