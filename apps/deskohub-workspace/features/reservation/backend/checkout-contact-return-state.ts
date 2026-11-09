import "server-only";

import { formatPhoneNumber, parsePhoneNumber } from "@deskohub/phone-number";
import { Effect, Option, Schema } from "effect";
import { makeAuthReturnState } from "@/features/account/backend/auth-return-state";
import {
  baseLocale,
  defaultPhoneRegion,
  type Locale,
  locales,
} from "@/features/i18n";
import { reservationBillingSelectionSchema } from "@/features/reservation/reservation-billing";
import {
  type ReservationCheckoutContact,
  reservationCheckoutContactSchema,
} from "@/features/reservation/reservation-checkout-contact";
import { normalizedReservationCustomerSchema } from "@/features/reservation/reservation-contact";

/**
 * The sealed contact and the locale it was typed in, whose region its phone
 * is read in. A token sealed before contacts carried a locale has none; its
 * phone was read in the base locale's region.
 */
const sealedCheckoutContactSchema = Schema.Struct({
  ...normalizedReservationCustomerSchema.fields,
  billing: reservationBillingSelectionSchema,
  marketingConsent: Schema.Boolean,
  locale: Schema.optionalKey(Schema.Literals(locales)),
});

const sealedCheckoutContact = makeAuthReturnState(
  "checkout-contact",
  sealedCheckoutContactSchema
);

/**
 * The phone a page in `pageLocale` prefills. A page whose locale reads a
 * number without a country calling code in another region gets the number in
 * international form, so its form reads the number the customer typed.
 */
const phoneForPage = (phone: string, region: string, pageLocale: Locale) =>
  region === defaultPhoneRegion(pageLocale)
    ? phone
    : Option.match(parsePhoneNumber(phone, region), {
        onNone: () => phone,
        onSome: formatPhoneNumber,
      });

/** The checkout contact details sealed into a sign-in's return path. */
export const checkoutContactReturnState = {
  /** Seals the contact typed on a page in `locale`. */
  seal: (contact: ReservationCheckoutContact, locale: Locale) =>
    sealedCheckoutContact.seal({ ...contact, locale }),
  /**
   * Opens a sealed contact for a page in `pageLocale`, its phone validated in
   * the region of the locale it was typed in.
   */
  open: (token: string, pageLocale: Locale) =>
    sealedCheckoutContact.open(token).pipe(
      Effect.flatMap(({ locale = baseLocale, ...sealed }) => {
        const region = defaultPhoneRegion(locale);
        return Schema.decodeEffect(reservationCheckoutContactSchema(region))(
          sealed
        ).pipe(
          Effect.map(
            (contact): ReservationCheckoutContact => ({
              ...contact,
              phone: phoneForPage(contact.phone, region, pageLocale),
            })
          )
        );
      })
    ),
};
