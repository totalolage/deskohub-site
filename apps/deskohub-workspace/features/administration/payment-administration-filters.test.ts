import { describe, expect, test } from "bun:test";
import {
  getAdministrationOperationFilters,
  getAdministrationOrderDateTimeBounds,
} from "./payment-administration-filters";

describe("payment administration filters", () => {
  test("caps provider queries to Nexi's one-month maximum", () => {
    const range = getAdministrationOrderDateTimeBounds(
      "2026-06-01",
      "2026-08-01",
      Temporal.PlainDate.from("2026-08-06")
    );

    expect(range.from).toBe("2026-06-01");
    expect(range.to).toBe("2026-06-30");
    expect(range.toTime).toBe("2026-06-30T22:00:00Z");
  });

  test("drops unsupported provider filters from deep links", () => {
    expect(
      getAdministrationOperationFilters({
        channel: "arbitrary-channel",
        operationType: "arbitrary-operation",
      })
    ).toEqual({ channel: undefined, operationType: undefined });
  });
});
