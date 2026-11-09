import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { EkonomickySubjekt } from "@deskohub/ares";
import { toAresBusinessBillingDraft } from "./ares-business-draft";

const syntheticCompany: EkonomickySubjekt = {
  ico: "27082440",
  obchodniJmeno: "Synthetická testovací s.r.o.",
  dic: "CZ27082440",
  sidlo: {
    nazevUlice: "Testovací ulice",
    cisloDomovni: 123,
    cisloOrientacni: 4,
    nazevCastiObce: "Staré Město",
    nazevObce: "Praha",
    psc: 11000,
    kodStatu: "CZ",
  },
};

describe("ARES company mapping to billing draft fields", () => {
  test("maps the verified company into billing fields including the address", () => {
    expect(toAresBusinessBillingDraft(syntheticCompany)).toEqual({
      companyName: "Synthetická testovací s.r.o.",
      companyId: "27082440",
      vatId: "CZ27082440",
      addressLine1: "Testovací ulice 123/4",
      addressLine2: "Staré Město",
      city: "Praha",
      zip: "11000",
      country: "CZ",
    });
  });

  test("omits absent optional values instead of returning empty strings", () => {
    const minimal: EkonomickySubjekt = {
      ico: "00000019",
      obchodniJmeno: "Synthetická minimalní organizace",
    };
    expect(toAresBusinessBillingDraft(minimal)).toEqual({
      companyName: "Synthetická minimalní organizace",
      companyId: "00000019",
    });
  });

  test("normalizes a padded street before joining it with the house number", () => {
    const paddedStreet: EkonomickySubjekt = {
      ...syntheticCompany,
      sidlo: {
        ...syntheticCompany.sidlo,
        nazevUlice: "  Testovací ulice  ",
      },
    };
    expect(toAresBusinessBillingDraft(paddedStreet).addressLine1).toBe(
      "Testovací ulice 123/4"
    );
  });

  test("omits a verified value that exceeds the billing field maximum instead of truncating", () => {
    const overlong = (length: number) => "X".repeat(length);
    expect(
      toAresBusinessBillingDraft({
        ico: "27082440",
        obchodniJmeno: overlong(201),
        dic: overlong(33),
        sidlo: {
          nazevUlice: overlong(201),
          nazevObce: overlong(101),
        },
      })
    ).toEqual({ companyId: "27082440" });
  });

  test("maps a non-Czech seat to no country code", () => {
    const foreign: EkonomickySubjekt = {
      ico: "27082440",
      obchodniJmeno: "Synthetická zahraniční organizace",
      sidlo: { nazevObce: "Bratislava", kodStatu: "SK" },
    };
    expect(toAresBusinessBillingDraft(foreign).country).toBeUndefined();
  });

  test("maps a raw generated registry record with a padded seat code to Czechia", () => {
    // The package's generated client decodes the raw ARES payload without
    // normalizing sidlo.kodStatu, and the service's transport (unexported
    // makeAresClient over the injected HttpClient) cannot be constructed at
    // this app boundary without provider access. This record is therefore
    // shaped exactly like the service's decoded generated output — including
    // the registry's whitespace-padded seat code — and is mapped without any
    // provider call, proving the raw-to-draft boundary keeps Czechia.
    const rawGeneratedRecord: EkonomickySubjekt = {
      ico: "27082440",
      obchodniJmeno: "  Synthetická testovací s.r.o.  ",
      dic: "   ",
      sidlo: {
        kodStatu: " CZ ",
        nazevUlice: "  ",
        cisloDomovni: 123,
        cisloOrientacni: 4,
        cisloOrientacniPismeno: "a",
        nazevObce: " Praha ",
      },
    };
    const draft = toAresBusinessBillingDraft(rawGeneratedRecord);
    expect(draft.country).toBe("CZ");
    expect(draft.companyName).toBe("Synthetická testovací s.r.o.");
    // The whitespace-only street name decodes to an absent street, so the
    // line keeps only the formatted house number.
    expect(draft.addressLine1).toBe("123/4a");
    expect(draft.city).toBe("Praha");
    expect(draft.vatId).toBeUndefined();
  });
});
