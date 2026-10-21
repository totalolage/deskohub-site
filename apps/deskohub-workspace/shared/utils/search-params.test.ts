import { describe, expect, test } from "bun:test";
import { getSearchParamsRecord, toURLSearchParams } from "./search-params";

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

describe("toURLSearchParams", () => {
  test("keeps every value of a repeated key and skips absent ones", () => {
    const params = toURLSearchParams({
      client_id: "https://assistant.invalid/client.json",
      ba_param: ["client_id", "scope"],
      scope: "offerings:read reservations:read",
      missing: undefined,
    });

    expect([...params]).toEqual([
      ["client_id", "https://assistant.invalid/client.json"],
      ["ba_param", "client_id"],
      ["ba_param", "scope"],
      ["scope", "offerings:read reservations:read"],
    ]);
  });
});
