import { describe, expect, test } from "bun:test";
import { m } from "@/features/i18n";

describe("reservation offer copy", () => {
  test("availability unavailable message names the selected setup with conditional monitor advice", () => {
    const reservedDeskName = "Reserved Desk – Afternoon";
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const openSpace = m.reservationAvailabilityUnavailable(
        { tier: "Open Space", date: "12. 9. 2026" },
        { locale }
      );
      expect(openSpace).toContain("Open Space");
      expect(openSpace).toContain("12. 9. 2026");

      const reservedDesk = m.reservationAvailabilityUnavailable(
        { tier: reservedDeskName, date: "3. 10. 2026" },
        { locale }
      );
      expect(reservedDesk).toContain(reservedDeskName);
      expect(reservedDesk).toContain("3. 10. 2026");
    }

    const en = m.reservationAvailabilityUnavailable(
      { tier: "Open Space", date: "12. 9. 2026" },
      { locale: "en-US" }
    );
    expect(en).not.toMatch(/\btier\b/i);
    expect(en).toMatch(/your selected reservation/i);
    expect(en).toMatch(/another offer|different offer/i);
    expect(en).toMatch(/date/i);
    expect(en).toMatch(/if you selected a workstation/i);
    expect(en).toMatch(/monitor setup/i);

    const cs = m.reservationAvailabilityUnavailable(
      { tier: "Open Space", date: "12. 9. 2026" },
      { locale: "cs-CZ" }
    );
    expect(cs).not.toMatch(/\btarif\b/i);
    expect(cs).toMatch(/rezervace nabídky/i);
    expect(cs).toMatch(/zvolené konfiguraci/i);
    expect(cs).toMatch(/jinou nabídku/);
    expect(cs).toMatch(/datum/);
    expect(cs).toMatch(/pracovní stanici/);
    expect(cs).toMatch(/sestavu monitorů/);
  });

  test("checkout status tier label reads Offer", () => {
    expect(m.checkoutStatusSummaryTierLabel({}, { locale: "en-US" })).toBe(
      "Offer"
    );
    expect(m.checkoutStatusSummaryTierLabel({}, { locale: "cs-CZ" })).toBe(
      "Nabídka"
    );
  });

  test("tier validation message reads Choose an offer", () => {
    expect(m.reservationValidationTierRequired({}, { locale: "en-US" })).toBe(
      "Choose an offer."
    );
    expect(m.reservationValidationTierRequired({}, { locale: "cs-CZ" })).toBe(
      "Vyber nabídku."
    );
  });
});
