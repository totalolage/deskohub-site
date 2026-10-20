import { describe, expect, test } from "bun:test";
import { getSearchParamsRecord } from "./search-params";

describe("getSearchParamsRecord", () => {
  test("reads search params in the shape Next.js passes to a page", () => {
    expect(
      getSearchParamsRecord(
        new URLSearchParams("status=complete&type=office&type=cowork&empty=")
      )
    ).toEqual({
      status: "complete",
      type: ["office", "cowork"],
      empty: "",
    });
  });
});
