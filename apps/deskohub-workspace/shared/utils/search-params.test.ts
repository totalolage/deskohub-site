import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import {
  getHrefWithSearchParams,
  getSearchParamsDecoder,
  getSearchParamsRecord,
  toURLSearchParams,
} from "./search-params";

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

describe("getSearchParamsDecoder", () => {
  const schema = Schema.Struct({
    sort: Schema.optionalKey(Schema.String),
    type: Schema.optionalKey(Schema.String),
  });

  test("reads a repeated key by its first value", () => {
    expect(
      getSearchParamsDecoder(schema)({
        sort: "total",
        type: ["office", "desk"],
      })
    ).toEqual(Option.some({ sort: "total", type: "office" }));
  });

  test("can read a repeated key as absent", () => {
    expect(
      getSearchParamsDecoder(schema, { repeated: "absent" })({
        sort: "total",
        type: ["office", "desk"],
      })
    ).toEqual(Option.some({ sort: "total" }));
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

describe("getHrefWithSearchParams", () => {
  test("adds present values to the path and leaves out empty ones", () => {
    expect(
      getHrefWithSearchParams("/admin/reservations", {
        direction: "desc",
        from: "",
        status: undefined,
        to: "2026-10-31",
      })
    ).toBe("/admin/reservations?direction=desc&to=2026-10-31");
    expect(getHrefWithSearchParams("/admin/reservations", {})).toBe(
      "/admin/reservations"
    );
  });
});
