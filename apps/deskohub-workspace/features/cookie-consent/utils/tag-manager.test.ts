import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  scheduleTagManagerLoad,
  TAG_MANAGER_FALLBACK_IDLE_DELAY_MS,
  TAG_MANAGER_IDLE_TIMEOUT_MS,
} from "./tag-manager";

const infoAddress = testEmailAddress("info");

const CONTAINER_ID = "GTM-TEST123";

type IdleCallback = () => void;
let idleCallbacks: { callback: IdleCallback; timeout?: number }[] = [];
let readyState: DocumentReadyState = "complete";

const tagManagerScripts = () =>
  Array.from(document.querySelectorAll("script")).filter((script) =>
    script.src.includes("googletagmanager.com/gtm.js")
  );

const runIdleCallbacks = () => {
  const pending = idleCallbacks;
  idleCallbacks = [];
  for (const { callback } of pending) callback();
};

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  // happy-dom never fetches scripts; report the container as loaded quietly.
  window.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => readyState,
  });
});

beforeEach(() => {
  readyState = "complete";
  idleCallbacks = [];
  window.dataLayer = [];
  const requestIdleCallback: typeof window.requestIdleCallback = (
    callback,
    options
  ) => {
    idleCallbacks.push({
      callback: () => callback({ didTimeout: false, timeRemaining: () => 0 }),
      timeout: options?.timeout,
    });
    return idleCallbacks.length;
  };
  window.requestIdleCallback = mock(requestIdleCallback);
  window.cancelIdleCallback = mock(() => {
    idleCallbacks = [];
  });
});

afterEach(() => {
  for (const script of tagManagerScripts()) script.remove();
});

afterAll(unregisterWorkspaceComponentTestEnv);

describe("scheduleTagManagerLoad", () => {
  test("waits for the window load event before scheduling idle work", () => {
    readyState = "loading";
    const cancel = scheduleTagManagerLoad(CONTAINER_ID);

    expect(idleCallbacks).toHaveLength(0);
    expect(tagManagerScripts()).toHaveLength(0);

    readyState = "complete";
    window.dispatchEvent(new Event("load"));
    expect(idleCallbacks).toEqual([
      expect.objectContaining({ timeout: TAG_MANAGER_IDLE_TIMEOUT_MS }),
    ]);
    expect(tagManagerScripts()).toHaveLength(0);

    runIdleCallbacks();
    expect(tagManagerScripts()).toHaveLength(1);
    cancel();
  });

  test("injects the container once the page is idle, after queued events", () => {
    window.dataLayer?.push({ event: "consent_update" });
    const cancel = scheduleTagManagerLoad(CONTAINER_ID);

    expect(tagManagerScripts()).toHaveLength(0);
    runIdleCallbacks();

    const [script] = tagManagerScripts();
    expect(script?.async).toBe(true);
    expect(script?.src).toBe(
      `https://www.googletagmanager.com/gtm.js?id=${CONTAINER_ID}`
    );
    expect(window.dataLayer?.[0]).toEqual({ event: "consent_update" });
    expect(window.dataLayer?.[1]).toEqual({
      "gtm.start": expect.any(Number),
      event: "gtm.js",
    });
    cancel();
  });

  test.each(["pointerdown"])(
    "loads immediately on the first %s and cancels the idle load",
    (eventType) => {
      const cancel = scheduleTagManagerLoad(CONTAINER_ID);

      window.dispatchEvent(new Event(eventType));
      expect(tagManagerScripts()).toHaveLength(1);
      expect(window.cancelIdleCallback).toHaveBeenCalled();

      runIdleCallbacks();
      window.dispatchEvent(new Event("pointerdown"));
      expect(tagManagerScripts()).toHaveLength(1);
      expect(
        window.dataLayer?.filter(
          (entry) => (entry as { event?: string }).event === "gtm.js"
        )
      ).toHaveLength(1);
      cancel();
    }
  );

  test.each([
    ["pointerover", `<a href="mailto:${infoAddress}">Email</a>`, "a"],
    ["focusin", "<form><button type='submit'>Send</button></form>", "button"],
  ])(
    "loads on %s toward a link-click or form-submit trigger target",
    (eventType, markup, selector) => {
      document.body.innerHTML = markup;
      const cancel = scheduleTagManagerLoad(CONTAINER_ID);

      document
        .querySelector(selector)
        ?.dispatchEvent(new Event(eventType, { bubbles: true }));
      expect(tagManagerScripts()).toHaveLength(1);
      cancel();
      document.body.innerHTML = "";
    }
  );

  test("ignores pointing at or focusing anything else", () => {
    document.body.innerHTML =
      '<a href="/en-US/contact">Contact</a><button type="button">Menu</button>';
    const cancel = scheduleTagManagerLoad(CONTAINER_ID);

    for (const element of document.querySelectorAll("a, button")) {
      element.dispatchEvent(new Event("pointerover", { bubbles: true }));
      element.dispatchEvent(new Event("focusin", { bubbles: true }));
    }
    expect(tagManagerScripts()).toHaveLength(0);
    cancel();
    document.body.innerHTML = "";
  });

  test("injects the container only once across repeated schedules", () => {
    // React StrictMode and remounting layouts schedule more than once.
    const cancelFirst = scheduleTagManagerLoad(CONTAINER_ID);
    cancelFirst();
    const cancelSecond = scheduleTagManagerLoad(CONTAINER_ID);
    runIdleCallbacks();
    const cancelThird = scheduleTagManagerLoad(CONTAINER_ID);
    runIdleCallbacks();
    window.dispatchEvent(new Event("keydown"));

    expect(tagManagerScripts()).toHaveLength(1);
    cancelSecond();
    cancelThird();
  });

  test("cancelling before the page is idle or touched loads nothing", () => {
    document.body.innerHTML = `<a href="mailto:${infoAddress}">Email</a>`;
    const cancel = scheduleTagManagerLoad(CONTAINER_ID);
    cancel();

    runIdleCallbacks();
    window.dispatchEvent(new Event("pointerdown"));
    document
      .querySelector("a")
      ?.dispatchEvent(new Event("pointerover", { bubbles: true }));
    document.body.innerHTML = "";
    expect(tagManagerScripts()).toHaveLength(0);
  });

  test("falls back to a delayed timer where idle callbacks are unsupported", () => {
    const originalRequestIdleCallback = window.requestIdleCallback;
    // @ts-expect-error Safari does not implement requestIdleCallback.
    window.requestIdleCallback = undefined;
    const timers: { callback: () => void; delay?: number }[] = [];
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = ((callback: () => void, delay?: number) => {
      timers.push({ callback, delay });
      return timers.length;
    }) as typeof window.setTimeout;

    try {
      const cancel = scheduleTagManagerLoad(CONTAINER_ID);
      expect(timers.map(({ delay }) => delay)).toEqual([
        TAG_MANAGER_FALLBACK_IDLE_DELAY_MS,
      ]);
      expect(TAG_MANAGER_FALLBACK_IDLE_DELAY_MS).toBeGreaterThan(0);
      expect(tagManagerScripts()).toHaveLength(0);
      for (const { callback } of timers) callback();
      expect(tagManagerScripts()).toHaveLength(1);
      cancel();
    } finally {
      window.setTimeout = originalSetTimeout;
      window.requestIdleCallback = originalRequestIdleCallback;
    }
  });
});
