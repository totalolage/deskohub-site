import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  type AnalyticsEvent,
  captureAnalyticsEvent,
  deliverAnalyticsEvents,
  discardAnalyticsEvents,
} from "./analytics-events";

const setConsentCookie = (categories: readonly string[]) => {
  // biome-ignore lint/suspicious/noDocumentCookie: The test controls the consent cookie the facade reads.
  document.cookie = `cc_cookie=${encodeURIComponent(
    JSON.stringify({ categories })
  )}; Path=/`;
};

let detach: (() => void) | undefined;

const collect = () => {
  const events: AnalyticsEvent[] = [];
  detach = deliverAnalyticsEvents((event) => {
    events.push(event);
  });
  return events;
};

describe("captureAnalyticsEvent", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });

  beforeEach(() => {
    window.happyDOM.setURL("https://deskohub.test/");
  });

  afterEach(() => {
    detach?.();
    detach = undefined;
    discardAnalyticsEvents();
    // biome-ignore lint/suspicious/noDocumentCookie: The test clears consent between cases.
    document.cookie = "cc_cookie=; Path=/; Max-Age=0";
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("holds consented events until analytics is ready, then sends them in order", () => {
    setConsentCookie(["necessary", "analytics"]);

    captureAnalyticsEvent("first", { step: 1 });
    captureAnalyticsEvent("second");
    const events = collect();
    captureAnalyticsEvent("third", { step: 3 });

    expect(events).toEqual([
      { event: "first", properties: { step: 1 } },
      { event: "second" },
      { event: "third", properties: { step: 3 } },
    ]);
  });

  test("keeps nothing captured without analytics consent", () => {
    setConsentCookie(["necessary"]);
    captureAnalyticsEvent("before consent");
    setConsentCookie(["necessary", "analytics"]);

    expect(collect()).toEqual([]);
  });

  test("drops held events when analytics discards them", () => {
    setConsentCookie(["necessary", "analytics"]);
    captureAnalyticsEvent("before withdrawal");
    discardAnalyticsEvents();

    expect(collect()).toEqual([]);
  });

  test("holds events again while analytics is paused", () => {
    setConsentCookie(["necessary", "analytics"]);
    const readyEvents = collect();
    detach?.();
    captureAnalyticsEvent("while paused");
    expect(readyEvents).toEqual([]);

    expect(collect()).toEqual([{ event: "while paused" }]);
  });
});
