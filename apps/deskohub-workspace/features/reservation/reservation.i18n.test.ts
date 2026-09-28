import { describe, expect, test } from "bun:test";
import { m } from "@/features/i18n";

describe("reservation offer copy", () => {
  test("availability unavailable message names the offer without tier or monitor copy", () => {
    const en = m.reservationAvailabilityUnavailable(
      { tier: "Open Space", date: "12. 9. 2026" },
      { locale: "en-US" }
    );
    expect(en).not.toMatch(/\btier\b/i);
    expect(en).not.toMatch(/monitor/i);
    expect(en).toMatch(/another offer|different offer/i);
    expect(en).toMatch(/date/i);

    const cs = m.reservationAvailabilityUnavailable(
      { tier: "Open Space", date: "12. 9. 2026" },
      { locale: "cs-CZ" }
    );
    expect(cs).not.toMatch(/\btarif/i);
    expect(cs).not.toMatch(/monitor/i);
    expect(cs).toMatch(/jinou nabídku|jinou nabídku/i);
    expect(cs).toMatch(/datum/i);
  });

  test("checkout status tier label reads Offer", () => {
    expect(
      m.checkoutStatusSummaryTierLabel({}, { locale: "en-US" })
    ).toBe("Offer");
    expect(
      m.checkoutStatusSummaryTierLabel({}, { locale: "cs-CZ" })
    ).toBe("Nabídka");
  });

  test("tier validation message reads Choose an offer", () => {
    expect(
      m.reservationValidationTierRequired({}, { locale: "en-US" })
    ).toBe("Choose an offer.");
    expect(
      m.reservationValidationTierRequired({}, { locale: "cs-CZ" })
    ).toBe("Vyber nabídku.");
  });
});
