import { describe, expect, test } from "bun:test";
import { getWorkspaceAvailabilityUrl } from "./workspace-availability-client";

describe("getWorkspaceAvailabilityUrl", () => {
  test("serializes cowork availability fields", () => {
    expect(
      getWorkspaceAvailabilityUrl({
        kind: "cowork",
        from: "2099-07-30",
        to: "2100-01-30",
        date: "2099-07-30",
        entryTier: "profi",
        monitorOption: "2x32-4k",
      })
    ).toBe(
      "/api/workspace/availability?kind=cowork&from=2099-07-30&to=2100-01-30&date=2099-07-30&entryTier=profi&monitorOption=2x32-4k"
    );
  });

  test("serializes meeting-room interval fields", () => {
    expect(
      getWorkspaceAvailabilityUrl({
        kind: "meeting-room",
        from: "2099-07-30",
        to: "2099-07-31",
        startsAt: "2099-07-30T08:00:00Z",
        endsAt: "2099-07-31T08:00:00Z",
      })
    ).toBe(
      "/api/workspace/availability?kind=meeting-room&from=2099-07-30&to=2099-07-31&startsAt=2099-07-30T08%3A00%3A00Z&endsAt=2099-07-31T08%3A00%3A00Z"
    );
  });
});
