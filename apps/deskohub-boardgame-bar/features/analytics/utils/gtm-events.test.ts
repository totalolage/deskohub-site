import { afterEach, describe, expect, test } from "bun:test";
import {
  sendGTMEvent,
  trackButtonClick,
  trackCustomEvent,
  trackFormSubmit,
  trackPageView,
  trackRoutePageView,
} from "./gtm-events";

const browserWindow = (dataLayer?: unknown[]) => {
  const window: { dataLayer?: unknown[] } = { dataLayer };
  Object.assign(globalThis, { window });
  return window;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("sendGTMEvent", () => {
  test("does nothing outside the browser", () => {
    expect(() => sendGTMEvent({ event: "server_render" })).not.toThrow();
    expect(Reflect.has(globalThis, "window")).toBe(false);
  });

  test("creates the data layer on the first event", () => {
    const window = browserWindow();

    sendGTMEvent({ event: "first", value: 1 });

    expect(window.dataLayer).toEqual([{ event: "first", value: 1 }]);
  });

  test("appends to an existing data layer", () => {
    const dataLayer: unknown[] = [{ event: "gtm.js" }];
    const window = browserWindow(dataLayer);

    sendGTMEvent({ event: "second" });

    expect(window.dataLayer).toBe(dataLayer);
    expect(dataLayer).toEqual([{ event: "gtm.js" }, { event: "second" }]);
  });
});

describe("tracked events", () => {
  test("push their event names and properties", () => {
    const window = browserWindow();

    trackPageView("/games");
    trackButtonClick("reserve", "hero");
    trackFormSubmit("contact", false);
    trackCustomEvent("filter_used", { filter: "players" });
    trackCustomEvent("bare_event");

    expect(window.dataLayer).toEqual([
      { event: "page_view", page_path: "/games" },
      {
        event: "button_click",
        button_name: "reserve",
        button_location: "hero",
      },
      { event: "form_submit", form_name: "contact", form_success: false },
      { event: "filter_used", filter: "players" },
      { event: "bare_event" },
    ]);
  });
});

describe("trackRoutePageView", () => {
  test("tracks the path with its query string", () => {
    const window = browserWindow();

    trackRoutePageView("/games", new URLSearchParams({ players: "4" }));

    expect(window.dataLayer).toEqual([
      { event: "page_view", page_path: "/games?players=4" },
    ]);
  });

  test("tracks the bare path without a query string", () => {
    const window = browserWindow();

    trackRoutePageView("/games", new URLSearchParams());
    trackRoutePageView("/contact", null);

    expect(window.dataLayer).toEqual([
      { event: "page_view", page_path: "/games" },
      { event: "page_view", page_path: "/contact" },
    ]);
  });

  test("tracks nothing before the path is known", () => {
    const window = browserWindow();

    trackRoutePageView(null, new URLSearchParams({ players: "4" }));
    trackRoutePageView("", null);

    expect(window.dataLayer).toBeUndefined();
  });
});
