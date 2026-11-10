import { isPhoneNumber } from "@deskohub/phone-number";
import { Predicate, Schema, SchemaGetter } from "effect";
import isEmail from "validator/lib/isEmail.js";
import { m } from "@/features/i18n";

const RESERVATION_VALIDATION = {
  name: { min: 2, max: 100 },
  email: { max: 255 },
  phone: { max: 20 },
} as const;

export const reservationCustomerNameSchema = Schema.Trim.check(
  Schema.isMinLength(RESERVATION_VALIDATION.name.min, {
    message: m.contactValidationNameMinimum({
      min: RESERVATION_VALIDATION.name.min,
    }),
  }),
  Schema.isMaxLength(RESERVATION_VALIDATION.name.max, {
    message: m.contactValidationNameMaximum({
      max: RESERVATION_VALIDATION.name.max,
    }),
  })
);

export const reservationCustomerEmailSchema = Schema.Trim.check(
  Schema.isNonEmpty({ message: m.contactValidationEmailRequired() }),
  Schema.isMaxLength(RESERVATION_VALIDATION.email.max, {
    message: m.contactValidationEmailMaximum({
      max: RESERVATION_VALIDATION.email.max,
    }),
  }),
  Schema.makeFilter((email) => isEmail(email), {
    message: m.contactValidationEmailInvalid(),
  })
);

// What a phone is in every region: the region decides only whether a number
// without a country calling code is valid.
const reservationCustomerPhoneTextSchema = Schema.Trim.check(
  Schema.isNonEmpty({ message: m.contactValidationPhoneRequired() }),
  Schema.isMaxLength(RESERVATION_VALIDATION.phone.max, {
    message: m.contactValidationPhoneMaximum({
      max: RESERVATION_VALIDATION.phone.max,
    }),
  })
);

/**
 * The phone a customer types, reading a number without a country calling code
 * in `defaultPhoneRegion` (the visitor locale's, `defaultPhoneRegion(locale)`).
 * It keeps the text as entered, trimmed.
 */
export const reservationCustomerPhoneSchema = (defaultPhoneRegion: string) =>
  reservationCustomerPhoneTextSchema.check(
    Schema.makeFilter(
      (phone: string) => isPhoneNumber(phone, defaultPhoneRegion),
      {
        message: m.contactValidationPhoneInvalid(),
      }
    )
  );

/** The contact a customer types, phone read in `defaultPhoneRegion`. */
export const reservationCustomerSchema = (defaultPhoneRegion: string) =>
  Schema.Struct({
    name: reservationCustomerNameSchema,
    email: reservationCustomerEmailSchema,
    phone: reservationCustomerPhoneSchema(defaultPhoneRegion),
  });

/**
 * The contact of a normalized reservation. It carries no locale, so its phone
 * is checked only for what holds in every region; whether a national number is
 * valid is decided where the customer's input enters, with the visitor
 * locale's region, and a provider parse reads it with the submission's locale.
 */
export const normalizedReservationCustomerSchema = Schema.Struct({
  name: Schema.toType(reservationCustomerNameSchema),
  email: Schema.toType(reservationCustomerEmailSchema),
  phone: Schema.toType(reservationCustomerPhoneTextSchema),
});

/**
 * Decode a reservation payload while dropping the retired customer-message
 * key so legacy signed Pay state remains restorable.
 */
export const droppingRetiredReservationCustomerMessage = <A, RD, RE>(
  schema: Schema.Codec<A, unknown, RD, RE>
): Schema.Codec<A, unknown, RD, RE> =>
  Schema.Unknown.pipe(
    Schema.decodeTo(schema, {
      decode: SchemaGetter.transform((input) => {
        if (Predicate.isObject(input) && !Array.isArray(input)) {
          const rest = { ...input };
          Reflect.deleteProperty(rest, "message");
          return rest;
        }
        return input;
      }),
      encode: SchemaGetter.transform((value) => value),
    })
  );
