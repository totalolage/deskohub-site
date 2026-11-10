import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  type InstallBarDismissal,
  isDismissed,
  noteClose,
  notePageView,
  VISIT_GAP_MS,
} from "./install-bar-dismissal";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const start = Date.parse("2026-11-10T12:00:00.000Z");

/** Page views at the given times; says whether each one hides the bar. */
const viewAt = (dismissal: InstallBarDismissal, now: number) => {
  const next = notePageView(dismissal, now);
  return { dismissal: next, dismissed: isDismissed(next, now) };
};

/** Closes the bar `closes` times, each on its own new visit. */
const closedTimes = (closes: number, lastCloseAt: number) => {
  let dismissal: InstallBarDismissal = { closes: 0 };
  for (let close = 1; close <= closes; close += 1) {
    const at = lastCloseAt - (closes - close) * 60 * DAY;
    dismissal = noteClose(notePageView(dismissal, at), at);
  }
  return dismissal;
};

describe("install bar dismissal schedule", () => {
  test("shows on every page view until the first close", () => {
    let dismissal: InstallBarDismissal = { closes: 0 };
    for (const at of [start, start + MINUTE, start + 3 * DAY]) {
      const view = viewAt(dismissal, at);
      expect(view.dismissed).toBe(false);
      dismissal = view.dismissal;
    }
  });

  describe("first close: hidden until the next visit", () => {
    const closed = closedTimes(1, start);

    test("stays hidden for the rest of the visit", () => {
      expect(isDismissed(closed, start)).toBe(true);
      expect(viewAt(closed, start + MINUTE).dismissed).toBe(true);
    });

    test("page views keep the visit going past 30 minutes in total", () => {
      let dismissal = closed;
      for (let view = 1; view <= 4; view += 1) {
        const next = viewAt(dismissal, start + view * 29 * MINUTE);
        expect(next.dismissed).toBe(true);
        dismissal = next.dismissal;
      }
    });

    test("29:59 after the last page view is still the same visit", () => {
      expect(viewAt(closed, start + VISIT_GAP_MS - 1).dismissed).toBe(true);
    });

    test("30 minutes after the last page view starts a new visit and shows", () => {
      const nextVisit = viewAt(closed, start + VISIT_GAP_MS);
      expect(nextVisit.dismissed).toBe(false);
      // and keeps showing through that visit
      expect(
        viewAt(nextVisit.dismissal, start + VISIT_GAP_MS + MINUTE)
      ).toMatchObject({ dismissed: false });
    });
  });

  describe("second close: hidden for 7 days", () => {
    const closed = closedTimes(2, start);

    test("hidden on a new visit just before 7 days", () => {
      expect(viewAt(closed, start + 7 * DAY - 1).dismissed).toBe(true);
    });

    test("shows again at exactly 7 days", () => {
      expect(viewAt(closed, start + 7 * DAY).dismissed).toBe(false);
    });
  });

  describe("third close: hidden for 30 days", () => {
    const closed = closedTimes(3, start);

    test("hidden just before 30 days", () => {
      expect(viewAt(closed, start + 30 * DAY - 1).dismissed).toBe(true);
    });

    test("shows again at exactly 30 days", () => {
      expect(viewAt(closed, start + 30 * DAY).dismissed).toBe(false);
    });
  });

  test("fourth close: hidden for good", () => {
    const closed = closedTimes(4, start);
    expect(closed.closes).toBe(4);
    expect(viewAt(closed, start + 10 * 365 * DAY).dismissed).toBe(true);
  });

  test("a close counts up and stamps its time", () => {
    const once = noteClose(notePageView({ closes: 0 }, start), start + MINUTE);
    expect(once).toEqual({
      closes: 1,
      closedAt: start + MINUTE,
      visitStartedAt: start,
      lastSeenAt: start + MINUTE,
    });
  });
});

describe("install bar dismissal storage", () => {
  let storage: typeof import("./install-bar-dismissal");

  beforeAll(async () => {
    GlobalRegistrator.register();
    storage = await import("./install-bar-dismissal");
  });

  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("keeps the record under its key as JSON", () => {
    expect(storage.recordInstallBarPageView(start)).toBe(false);
    storage.recordInstallBarClose(start + MINUTE);

    expect(
      JSON.parse(
        globalThis.localStorage.getItem(
          storage.installBarDismissalStorageKey
        ) ?? "null"
      )
    ).toEqual({
      closes: 1,
      closedAt: start + MINUTE,
      visitStartedAt: start,
      lastSeenAt: start + MINUTE,
    });
    expect(storage.recordInstallBarPageView(start + 2 * MINUTE)).toBe(true);
    expect(
      storage.recordInstallBarPageView(start + 2 * MINUTE + VISIT_GAP_MS)
    ).toBe(false);
  });

  test("honours a record written by hand", () => {
    globalThis.localStorage.setItem(
      storage.installBarDismissalStorageKey,
      JSON.stringify({ closes: 3, closedAt: start })
    );

    expect(storage.recordInstallBarPageView(start + 29 * DAY)).toBe(true);
    expect(storage.recordInstallBarPageView(start + 30 * DAY)).toBe(false);
  });

  test("treats a missing or unreadable record as never closed", () => {
    expect(storage.readInstallBarDismissal()).toEqual({ closes: 0 });
    for (const raw of ["not json", '{"closes":"two"}', "[]"]) {
      globalThis.localStorage.setItem(
        storage.installBarDismissalStorageKey,
        raw
      );
      expect(storage.readInstallBarDismissal()).toEqual({ closes: 0 });
    }
  });
});
