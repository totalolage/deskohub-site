import { describe, expect, test } from "bun:test";
import { m } from "./index";

describe("reservation validation messages", () => {
  test("pluralizes the office duration limit by locale", () => {
    expect(
      m.reservationValidationOfficeMaximumDuration(
        { hours: 1 },
        { locale: "en-US" }
      )
    ).toBe("An office reservation cannot exceed 1 hour.");
    expect(
      m.reservationValidationOfficeMaximumDuration(
        { hours: 2 },
        { locale: "cs-CZ" }
      )
    ).toBe("Rezervace kanceláře nesmí přesáhnout 2 hodiny.");
    expect(
      m.reservationValidationOfficeMaximumDuration(
        { hours: 5 },
        { locale: "cs-CZ" }
      )
    ).toBe("Rezervace kanceláře nesmí přesáhnout 5 hodin.");
  });
});
