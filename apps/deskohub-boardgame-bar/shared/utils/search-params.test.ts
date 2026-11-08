import { describe, expect, test } from "bun:test";
import { getSearchParam } from "./search-params";

describe("getSearchParam", () => {
  test("reads the first value from URLSearchParams", () => {
    const params = new URLSearchParams("date=2026-11-02&date=2026-11-03");

    expect(getSearchParam(params, "date")).toBe("2026-11-02");
    expect(getSearchParam(params, "time")).toBeUndefined();
  });

  test("reads a string, the first array item, or nothing from a record", () => {
    const params = {
      date: "2026-11-02",
      guests: ["4", "6"],
      empty: [],
      time: undefined,
    };

    expect(getSearchParam(params, "date")).toBe("2026-11-02");
    expect(getSearchParam(params, "guests")).toBe("4");
    expect(getSearchParam(params, "empty")).toBeUndefined();
    expect(getSearchParam(params, "time")).toBeUndefined();
    expect(getSearchParam(params, "missing")).toBeUndefined();
  });
});
