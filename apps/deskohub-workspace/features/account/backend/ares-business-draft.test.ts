import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { AresCompany } from "@deskohub/ares";
import { toAresBusinessBillingDraft } from "./ares-business-draft";

const syntheticCompany: AresCompany = {
  ico: "27082440",
  obchodniJmeno: "Synthetická testovací s.r.o.",
  dic: "CZ27082440",
  sidlo: {
    ulice: "Testovací ulice",
    cisloDomovni: "123",
    cisloOrientacni: "4",
    obec: "Praha",
    psc: "11000",
    statKod: "CZ",
  },
};

describe("ARES company mapping to billing draft fields", () => {
  test("maps the verified company into billing fields including the address", () => {
    expect(toAresBusinessBillingDraft(syntheticCompany)).toEqual({
      companyName: "Synthetická testovací s.r.o.",
      companyId: "27082440",
      vatId: "CZ27082440",
      addressLine1: "Testovací ulice 123/4",
      city: "Praha",
      zip: "11000",
      country: "CZ",
    });
  });

  test("omits absent optional values instead of returning empty strings", () => {
    const minimal: AresCompany = {
      ico: "00000019",
      obchodniJmeno: "Synthetická minimalní organizace",
    };
    expect(toAresBusinessBillingDraft(minimal)).toEqual({
      companyName: "Synthetická minimalní organizace",
      companyId: "00000019",
    });
  });

  test("builds the house number without an orientation number", () => {
    const withoutOrientation: AresCompany = {
      ...syntheticCompany,
      sidlo: { ...syntheticCompany.sidlo, cisloOrientacni: undefined },
    };
    expect(toAresBusinessBillingDraft(withoutOrientation).addressLine1).toBe(
      "Testovací ulice 123"
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
          ulice: overlong(201),
          obec: overlong(101),
          psc: overlong(21),
        },
      })
    ).toEqual({ companyId: "27082440" });
  });

  test("omits an undetermined seat country instead of defaulting to Czechia", () => {
    const unknownSeat: AresCompany = {
      ico: "27082440",
      obchodniJmeno: "Synthetická neurčitá organizace",
      sidlo: { obec: "Praha" },
    };
    const draft = toAresBusinessBillingDraft(unknownSeat);
    expect(draft.country).toBeUndefined();
    expect(draft.city).toBe("Praha");
    expect(draft.companyName).toBe("Synthetická neurčitá organizace");
  });

  test("maps a non-Czech seat to no country code", () => {
    const foreign: AresCompany = {
      ico: "27082440",
      obchodniJmeno: "Synthetická zahraniční organizace",
      sidlo: { obec: "Bratislava", statKod: "SK" },
    };
    expect(toAresBusinessBillingDraft(foreign).country).toBeUndefined();
  });

  test("omits a blank seat-country code instead of defaulting to Czechia", () => {
    const blankSeat: AresCompany = {
      ico: "27082440",
      obchodniJmeno: "Synthetická prázdná organizace",
      sidlo: { obec: "Praha", statKod: "  " },
    };
    expect(toAresBusinessBillingDraft(blankSeat).country).toBeUndefined();
  });
});
