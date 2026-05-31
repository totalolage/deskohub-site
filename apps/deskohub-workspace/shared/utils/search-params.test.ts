import { describe, expect, test } from "bun:test";
import { getSearchParam } from "./search-params";

describe("getSearchParam", () => {
  test("reads first values from Next search param records", () => {
    expect(getSearchParam({ token: ["first", "second"] }, "token")).toBe(
      "first"
    );
    expect(getSearchParam({ token: "single" }, "token")).toBe("single");
    expect(getSearchParam({}, "token")).toBeUndefined();
  });

  test("reads values from URLSearchParams", () => {
    const searchParams = new URLSearchParams("token=first&token=second");

    expect(getSearchParam(searchParams, "token")).toBe("first");
    expect(getSearchParam(searchParams, "missing")).toBeUndefined();
  });
});
