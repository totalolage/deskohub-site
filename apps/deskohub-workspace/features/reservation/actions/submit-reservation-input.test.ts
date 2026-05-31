import { describe, expect, test } from "bun:test";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import { getReservationOrderSchema } from "@/features/reservation/schemas/reservation";
import {
  getSubmitReservationCheckoutLocale,
  getSubmitReservationSchema,
} from "./submit-reservation-input";

const validSubmit = {
  locale: "en-US",
  payStateToken: "dhp1.test-token",
  legalConsent: true,
};

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
    const input = schema.parse(validSubmit);

    expect(getSubmitReservationCheckoutLocale(input, "cs-CZ")).toBe("en-US");
  });

  test("accepts Czech route locale for checkout creation", () => {
    const schema = getSubmitReservationSchema();
    const input = schema.parse({
      ...validSubmit,
      locale: "cs-CZ",
    });

    expect(getSubmitReservationCheckoutLocale(input, "en-US")).toBe("cs-CZ");
  });

  test("rejects unsupported route locales", () => {
    const schema = getSubmitReservationSchema();

    expect(
      schema.safeParse({
        ...validSubmit,
        locale: "de-DE",
      }).success
    ).toBe(false);
  });

  test("accepts actual legal consent value for service enforcement", () => {
    const schema = getSubmitReservationSchema();

    expect(schema.parse({ ...validSubmit, legalConsent: false })).toEqual({
      ...validSubmit,
      legalConsent: false,
    });
    expect(
      schema.safeParse({
        locale: "en-US",
        payStateToken: "",
        legalConsent: true,
      }).success
    ).toBe(false);
  });
});

describe("reservation order schema", () => {
  test("does not include or require legal consent", () => {
    const schema = getReservationOrderSchema();

    expect(schema.parse(validReservation)).toEqual({
      entryTier: "basic-day-pass",
      date: "2099-06-10",
      coffee: false,
      name: "Locale Test",
      email: "locale-test@example.com",
      phone: "+420777123463",
      message: "Locale propagation test",
    });
    expect(
      schema.safeParse({
        entryTier: "basic-day-pass",
        date: "2099-06-10",
        coffee: false,
        name: "Locale Test",
        email: "locale-test@example.com",
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
