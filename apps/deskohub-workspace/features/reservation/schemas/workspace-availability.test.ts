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
  });
});
