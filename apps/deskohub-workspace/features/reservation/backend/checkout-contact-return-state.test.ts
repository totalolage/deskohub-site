import { describe, expect, mock, test } from "bun:test";
import { parsePhoneNumber } from "@deskohub/phone-number";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Option, Schema } from "effect";
import { makeAuthReturnState } from "@/features/account/backend/auth-return-state";
import { defaultPhoneRegion, type Locale } from "@/features/i18n";
import { reservationBillingSelectionSchema } from "@/features/reservation/reservation-billing";
import type { ReservationCheckoutContact } from "@/features/reservation/reservation-checkout-contact";
import {
  normalizedReservationCustomerSchema,
  reservationCustomerPhoneSchema,
} from "@/features/reservation/reservation-contact";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";

mock.module("server-only", () => ({}));

const { checkoutContactReturnState } = await import(
  "./checkout-contact-return-state"
);

const contactWithPhone = (phone: string): ReservationCheckoutContact => ({
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone,
  billing: { purpose: "personal", invoice: "none" },
  marketingConsent: false,
});

const seal = (contact: ReservationCheckoutContact, locale: Locale) =>
  Effect.runPromise(
    checkoutContactReturnState
      .seal(contact, locale)
      .pipe(Effect.provide(TestSealedStateKeys))
  );

const open = (token: string, pageLocale: Locale) =>
  Effect.runPromise(
    checkoutContactReturnState
      .open(token, pageLocale)
      .pipe(Effect.option, Effect.provide(TestSealedStateKeys))
  ).then(Option.getOrUndefined);

describe("checkout contact return state", () => {
  test.each([
    ["cs-CZ", "777 123 456"],
    ["en-US", "777 123 456"],
    ["de-DE", "0151 23456789"],
    ["uk-UA", "050 123 4567"],
    ["cs-CZ", "+49 151 23456789"],
  ] as const)(
    "reopens a contact sealed under %s on a page in the same locale as it was typed (%s)",
    async (locale, phone) => {
      const contact = contactWithPhone(phone);

      expect(await open(await seal(contact, locale), locale)).toEqual(contact);
    }
  );

  test("reopens a cs-CZ contact on an en-US page as it was typed, both reading national numbers in CZ", async () => {
    const contact = contactWithPhone("777 123 456");

    expect(await open(await seal(contact, "cs-CZ"), "en-US")).toEqual(contact);
  });

  test.each([
    ["de-DE", "0151 23456789", "cs-CZ", "+49 1512 3456789"],
    ["uk-UA", "050 123 4567", "en-US", "+380 50 123 4567"],
    ["sk-SK", "0912 345 678", "de-DE", "+421 912 345 678"],
    ["cs-CZ", "777 123 456", "uk-UA", "+420 777 123 456"],
  ] as const)(
    "offers a %s national number (%s) on a %s page in international form",
    async (sealedLocale, phone, pageLocale, presented) => {
      const contact = contactWithPhone(phone);
      const reopened = await open(
        await seal(contact, sealedLocale),
        pageLocale
      );

      expect(reopened).toEqual({ ...contact, phone: presented });
      // The page's own phone field accepts it as the number that was typed.
      const pageRegion = defaultPhoneRegion(pageLocale);
      expect(
        Schema.decodeUnknownOption(reservationCustomerPhoneSchema(pageRegion))(
          presented
        )
      ).toEqual(Option.some(presented));
      expect(parsePhoneNumber(presented, pageRegion)).toEqual(
        parsePhoneNumber(phone, defaultPhoneRegion(sealedLocale))
      );
      // Sealed again on that page, it survives another language switch.
      if (!reopened) throw new Error("Expected the contact to reopen");
      expect(
        await open(await seal(reopened, pageLocale), sealedLocale)
      ).toEqual(reopened);
    }
  );

  test("reads a token sealed before contacts carried a locale in the base locale's region", async () => {
    const legacyState = makeAuthReturnState(
      "checkout-contact",
      Schema.Struct({
        ...normalizedReservationCustomerSchema.fields,
        billing: reservationBillingSelectionSchema,
        marketingConsent: Schema.Boolean,
      })
    );
    const czechContact = contactWithPhone("777 123 456");
    const sealLegacy = (contact: ReservationCheckoutContact) =>
      Effect.runPromise(
        legacyState.seal(contact).pipe(Effect.provide(TestSealedStateKeys))
      );

    expect(await open(await sealLegacy(czechContact), "cs-CZ")).toEqual(
      czechContact
    );
    expect(await open(await sealLegacy(czechContact), "de-DE")).toEqual({
      ...czechContact,
      phone: "+420 777 123 456",
    });
    // A German national number was never valid in the base locale's region.
    expect(
      await open(await sealLegacy(contactWithPhone("0151 23456789")), "de-DE")
    ).toBeUndefined();
  });

  test("does not open a contact whose phone its sealed locale's region rejects", async () => {
    const token = await seal(contactWithPhone("0151 23456789"), "cs-CZ");

    expect(await open(token, "cs-CZ")).toBeUndefined();
    expect(await open(token, "de-DE")).toBeUndefined();
  });
});
