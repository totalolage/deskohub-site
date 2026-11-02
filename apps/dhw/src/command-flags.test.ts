import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { presentFlagValues } from "./command-flags";

describe("presentFlagValues", () => {
  test("keeps passed flags under their request fields in the given order", () => {
    const values = presentFlagValues({
      customerId: Option.some("customer-1"),
      date: Option.none<string>(),
      page: Option.some(2),
      sort: Option.some("date"),
    });

    expect(values).toEqual({ customerId: "customer-1", page: 2, sort: "date" });
    expect(Object.keys(values)).toEqual(["customerId", "page", "sort"]);
  });

  test("leaves out every flag the operator did not pass", () => {
    expect(
      presentFlagValues({ from: Option.none(), to: Option.none() })
    ).toEqual({});
  });
});
