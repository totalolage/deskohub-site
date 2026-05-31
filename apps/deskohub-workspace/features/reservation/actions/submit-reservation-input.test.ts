import { describe, expect, test } from "bun:test";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import {
  getSubmitReservationCheckoutLocale,
  getSubmitReservationSchema,
} from "./submit-reservation-input";

const validReservation = {
  entryTier: "basic-day-pass",
  date: "2099-06-10",
  coffee: false,
  name: "Locale Test",
  email: "locale-test@example.com",
  phone: "+420777123463",
  message: "Locale propagation test",
  legalConsent: true,
};

describe("submit reservation locale input", () => {
  test("uses explicit route locale instead of action context locale", () => {
    const schema = getSubmitReservationSchema();
    const input = schema.parse({
      locale: "en-US",
      reservation: validReservation,
    });

    expect(getSubmitReservationCheckoutLocale(input, "cs-CZ")).toBe("en-US");
  });

  test("accepts Czech route locale for checkout creation", () => {
    const schema = getSubmitReservationSchema();
    const input = schema.parse({
      locale: "cs-CZ",
      reservation: validReservation,
    });

    expect(getSubmitReservationCheckoutLocale(input, "en-US")).toBe("cs-CZ");
  });

  test("rejects unsupported route locales", () => {
    const schema = getSubmitReservationSchema();

    expect(
      schema.safeParse({
        locale: "de-DE",
        reservation: validReservation,
      }).success
    ).toBe(false);
  });
});

describe("checkout legal snapshot locale", () => {
  test("uses English paths for English checkout creation", async () => {
    const documents = await getLegalAcceptanceSnapshot("en-US");

    expect(documents.termsAndConditions.path).toBe(
      "/en-US/terms-and-conditions"
    );
    expect(documents.operatingRules.path).toBe("/en-US/operating-rules");
    expect(documents.privacyPolicy.path).toBe("/en-US/privacy-policy");
  });

  test("uses Czech paths for Czech checkout creation", async () => {
    const documents = await getLegalAcceptanceSnapshot("cs-CZ");

    expect(documents.termsAndConditions.path).toBe(
      "/cs-CZ/terms-and-conditions"
    );
    expect(documents.operatingRules.path).toBe("/cs-CZ/operating-rules");
    expect(documents.privacyPolicy.path).toBe("/cs-CZ/privacy-policy");
  });
});
