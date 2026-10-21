import { describe, expect, test } from "bun:test";
import { toURLSearchParams } from "./search-params";

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
