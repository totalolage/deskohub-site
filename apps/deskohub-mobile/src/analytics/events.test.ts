import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnalyticsEvent } from "./analytics";
import { createAnalyticsEvents } from "./events";

const record = () => {
  const events: (AnalyticsEvent | { readonly screen: string })[] = [];
  const tracked = createAnalyticsEvents({
    capture: (event) => events.push(event),
    screen: (name) => events.push({ screen: name }),
  });
  return { events, tracked };
};

describe("analytics events", () => {
  test("records a screen view by pathname", () => {
    const { events, tracked } = record();
    tracked.trackScreenView("/reservation");
    expect(events).toEqual([{ screen: "/reservation" }]);
  });

  test("names sign-in events like the site and holds completion for the account", () => {
    const { events, tracked } = record();
    tracked.trackSignInStarted("passkey");
    tracked.trackSignInCompleted("link");
    expect(events).toEqual([
      { name: "sign-in started", properties: { method: "passkey" } },
      {
        name: "sign-in completed",
        properties: { method: "link" },
        awaitsAccount: true,
      },
    ]);
  });

  test("records booking events with the reservation kind", () => {
    const { events, tracked } = record();
    tracked.trackBookingStarted("meeting_room");
    tracked.trackBookingSubmitted("office");
    expect(events).toEqual([
      {
        name: "booking started",
        properties: { reservation_kind: "meeting_room" },
      },
      { name: "booking submitted", properties: { reservation_kind: "office" } },
    ]);
  });

  test("records access PIN views without properties", () => {
    const { events, tracked } = record();
    tracked.trackAccessPinViewed();
    expect(events).toEqual([{ name: "access PIN viewed" }]);
  });

  test("records applied updates with only the known fields", () => {
    const { events, tracked } = record();
    tracked.trackUpdateApplied({ updateId: "u1", runtimeVersion: "1.0.0" });
    tracked.trackUpdateApplied({});
    expect(events).toEqual([
      {
        name: "update applied",
        properties: { update_id: "u1", runtime_version: "1.0.0" },
      },
      { name: "update applied", properties: {} },
    ]);
  });
});

const appRoot = join(import.meta.dir, "../..");
const importStatements = /^import[^;]*?from\s*["'][^"']+["'];?/gm;

/** The app's production sources, routes and modules, without their imports. */
const productionSources = async () => {
  const sources: string[] = [];
  for (const pattern of ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"]) {
    for await (const path of new Bun.Glob(pattern).scan(appRoot)) {
      if (/\.test\.tsx?$|\/testing\/|^src\/analytics\/events\.ts$/.test(path))
        continue;
      const source = await readFile(join(appRoot, path), "utf8");
      sources.push(source.replace(importStatements, ""));
    }
  }
  return sources;
};

describe("analytics event callers", () => {
  test("every event is recorded somewhere in the app", async () => {
    const sources = await productionSources();
    const trackers = Object.keys(
      createAnalyticsEvents({
        capture: () => undefined,
        screen: () => undefined,
      })
    );

    const unused = trackers.filter(
      (tracker) =>
        !sources.some((source) => new RegExp(`\\b${tracker}\\b`).test(source))
    );

    expect(unused).toEqual([]);
  });
});
