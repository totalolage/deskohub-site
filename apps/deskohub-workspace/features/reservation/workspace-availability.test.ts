import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { parseWorkspaceAvailabilityQuery } from "./workspace-availability";

describe("parseWorkspaceAvailabilityQuery", () => {
  test("maps public kind query param to the internal reservation tag", () => {
    const query = parseWorkspaceAvailabilityQuery(
      new URLSearchParams({
        kind: "meeting-room",
        from: "2099-06-10",
        to: "2099-06-10",
      })
    );

    expect(query).toMatchObject({
      _tag: "meeting-room",
      from: "2099-06-10",
      to: "2099-06-10",
    });
    expect(query).not.toHaveProperty("date");
  });

  test("does not treat meeting room as a cowork entry tier", () => {
    const query = parseWorkspaceAvailabilityQuery(
      new URLSearchParams({
        entryTier: "meeting-room",
        from: "2099-06-10",
        to: "2099-06-10",
      })
    );

    expect(query).toEqual({
      _tag: "cowork",
      from: "2099-06-10",
      to: "2099-06-10",
    });
  });

  test("drops interval fields from cowork availability queries", () => {
    const query = parseWorkspaceAvailabilityQuery(
      new URLSearchParams({
        kind: "cowork",
        date: "2099-06-10",
        from: "2099-06-10",
        to: "2099-06-10",
        startsAt: "10:00",
        endsAt: "11:00",
      })
    );

    expect(query).toEqual({
      _tag: "cowork",
      date: "2099-06-10",
      from: "2099-06-10",
      to: "2099-06-10",
    });
  });
});
