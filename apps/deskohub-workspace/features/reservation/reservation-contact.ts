import { Predicate, Schema, SchemaGetter } from "effect";
import { isValidPhoneNumber } from "libphonenumber-js";
import isEmail from "validator/lib/isEmail.js";
import { m } from "@/features/i18n";

export const RESERVATION_VALIDATION = {
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

export const reservationCustomerPhoneSchema = Schema.Trim.check(
  Schema.isNonEmpty({ message: m.contactValidationPhoneRequired() }),
  Schema.isMaxLength(RESERVATION_VALIDATION.phone.max, {
    message: m.contactValidationPhoneMaximum({
      max: RESERVATION_VALIDATION.phone.max,
    }),
  }),
  Schema.makeFilter((phone) => isValidPhoneNumber(phone, "CZ"), {
    message: m.contactValidationPhoneInvalid(),
  })
);

export const reservationCustomerSchema = Schema.Struct({
  name: reservationCustomerNameSchema,
  email: reservationCustomerEmailSchema,
  phone: reservationCustomerPhoneSchema,
});

export const normalizedReservationCustomerSchema = Schema.Struct({
  name: Schema.toType(reservationCustomerNameSchema),
  email: Schema.toType(reservationCustomerEmailSchema),
  phone: Schema.toType(reservationCustomerPhoneSchema),
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
