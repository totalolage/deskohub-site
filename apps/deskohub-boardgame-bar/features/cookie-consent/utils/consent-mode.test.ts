import { afterEach, describe, expect, test } from "bun:test";
import {
  CONSENT_UPDATED_EVENT,
  type CookieConsentChoices,
  DEFAULT_CONSENT_STATE,
  initializeConsentMode,
  syncConsentMode,
  updateConsentMode,
} from "./consent-mode";

type FakeWindow = EventTarget & Pick<Window, "dataLayer" | "gtag">;

const browser = globalThis as { window?: FakeWindow };

/** Installs a browser `window` whose `gtag` records every call. */
const installWindow = (
  window: Partial<Pick<Window, "dataLayer">> & { gtag?: false } = {}
) => {
  const gtagCalls: unknown[][] = [];
  const fakeWindow: FakeWindow = Object.assign(new EventTarget(), {
    dataLayer: window.dataLayer,
    gtag:
      window.gtag === false
        ? undefined
        : (...call: unknown[]) => {
            gtagCalls.push(call);
          },
  });
  browser.window = fakeWindow;
  return { window: fakeWindow, gtagCalls };
};

afterEach(() => {
  delete browser.window;
});

describe("initializeConsentMode", () => {
  test("creates the data layer and sets the default consent", () => {
    const { window, gtagCalls } = installWindow();

    initializeConsentMode();

    expect(window.dataLayer).toEqual([]);
    expect(gtagCalls).toEqual([["consent", "default", DEFAULT_CONSENT_STATE]]);
  });

  test("keeps an existing data layer", () => {
    const dataLayer = [{ event: "gtm.js" }];
    const { window } = installWindow({ dataLayer });

    initializeConsentMode();

    expect(window.dataLayer).toBe(dataLayer);
    expect(window.dataLayer).toEqual([{ event: "gtm.js" }]);
  });

  test("still creates the data layer before gtag has loaded", () => {
    const { window } = installWindow({ gtag: false });

    initializeConsentMode();

    expect(window.dataLayer).toEqual([]);
  });

  test("does nothing on the server", () => {
    expect(() => initializeConsentMode()).not.toThrow();
    expect(browser.window).toBeUndefined();
  });
});

describe("updateConsentMode", () => {
  test("sends the consent update to gtag", () => {
    const { gtagCalls } = installWindow();

    updateConsentMode({ analytics_storage: "granted" });

    expect(gtagCalls).toEqual([
      ["consent", "update", { analytics_storage: "granted" }],
    ]);
  });

  test("skips the update before gtag has loaded", () => {
    installWindow({ gtag: false });

    expect(() =>
      updateConsentMode({ analytics_storage: "granted" })
    ).not.toThrow();
  });

  test("does nothing on the server", () => {
    expect(() =>
      updateConsentMode({ analytics_storage: "granted" })
    ).not.toThrow();
  });
});

const bannerChoices = (
  accepted: string[] | undefined
): CookieConsentChoices => ({
  getUserPreferences: () =>
    ({ acceptedCategories: accepted }) as ReturnType<
      CookieConsentChoices["getUserPreferences"]
    >,
  acceptedCategory: (category) => accepted?.includes(category) ?? false,
});

const announcedCategories = (window: EventTarget) => {
  const announced: unknown[] = [];
  window.addEventListener(CONSENT_UPDATED_EVENT, (event) => {
    announced.push((event as CustomEvent).detail);
  });
  return announced;
};

describe("syncConsentMode", () => {
  test("grants accepted categories, denies the rest, and announces the choice", () => {
    const { window, gtagCalls } = installWindow();
    const announced = announcedCategories(window);

    syncConsentMode(bannerChoices(["necessary", "analytics", "preferences"]));

    expect(gtagCalls).toEqual([
      ["consent", "update", { analytics_storage: "granted" }],
      [
        "consent",
        "update",
        {
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
      ["consent", "update", { personalization_storage: "granted" }],
    ]);
    expect(announced).toEqual([
      { acceptedCategories: ["necessary", "analytics", "preferences"] },
    ]);
  });

  test("grants marketing storage when marketing is accepted", () => {
    const { gtagCalls } = installWindow();

    syncConsentMode(bannerChoices(["necessary", "marketing"]));

    expect(gtagCalls).toEqual([
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
    ]);
  });

  test("announces no categories before the visitor has chosen", () => {
    const { window } = installWindow();
    const announced = announcedCategories(window);

    syncConsentMode(bannerChoices(undefined));

    expect(announced).toEqual([{ acceptedCategories: [] }]);
  });

  test("reads the banner without announcing on the server", () => {
    const asked: string[] = [];

    syncConsentMode({
      ...bannerChoices([]),
      acceptedCategory: (category) => {
        asked.push(category);
        return false;
      },
    });

    expect(asked).toEqual(["analytics", "marketing", "preferences"]);
  });
});
