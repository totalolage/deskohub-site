import { Effect, Option, Schema, SchemaGetter, SchemaIssue } from "effect";
import {
  type CountryCode,
  isValidPhoneNumber,
  parsePhoneNumberWithError,
} from "libphonenumber-js";

/** A number entered without an international prefix is read as Czech. */
const defaultCountry: CountryCode = "CZ";

const parseText = Option.liftThrowable((text: string) =>
  parsePhoneNumberWithError(text, defaultCountry)
);

/**
 * The E.164 form of the valid number a text holds. The number may sit inside
 * other text, such as a label, and an extension is dropped. Blank text, text
 * without a number, and a number no numbering plan allows have none.
 */
const toE164 = (text: string): Option.Option<string> =>
  parseText(text.trim()).pipe(
    Option.filter((parsed) => parsed.isValid()),
    Option.map((parsed) => parsed.format("E.164"))
  );

const E164PhoneNumberSchema = Schema.String.check(
  Schema.makeFilter((value: string) => Option.contains(toE164(value), value), {
    message: "must be a valid phone number in E.164 form",
  })
)
  .pipe(Schema.brand("PhoneNumber"))
  .annotate({
    identifier: "PhoneNumber",
    description: "A valid phone number in E.164 form, such as +420777123456.",
  });

/** A valid phone number in E.164 form, such as `+420777123456`. */
export type PhoneNumber = typeof E164PhoneNumberSchema.Type;

/**
 * The phone number a text holds, read as Czech when it has no international
 * prefix. Text around the number, such as a label, is ignored, and an
 * extension is dropped. Blank or unreadable text and an invalid number have
 * none.
 */
export const parsePhoneNumber = (text: string): Option.Option<PhoneNumber> =>
  Option.map(toE164(text), (value) => E164PhoneNumberSchema.make(value));

/**
 * Whether the whole text, apart from surrounding whitespace, is one valid
 * phone number, read as Czech when it has no international prefix. Unlike
 * parsePhoneNumber, any other text around the number fails it.
 */
export const isPhoneNumber = (text: string): boolean =>
  isValidPhoneNumber(text.trim(), defaultCountry);

/**
 * Decodes entered text to the phone number parsePhoneNumber reads from it,
 * and encodes a phone number as its E.164 text.
 */
export const PhoneNumberSchema = Schema.String.pipe(
  Schema.decodeTo(E164PhoneNumberSchema, {
    decode: SchemaGetter.transformOrFail((text: string) =>
      Option.match(parsePhoneNumber(text), {
        onNone: () =>
          Effect.fail(
            new SchemaIssue.InvalidValue(Option.some(text), {
              message: "Invalid phone number",
            })
          ),
        onSome: Effect.succeed,
      })
    ),
    encode: SchemaGetter.transform((phone: string) => phone),
  })
).annotate({
  identifier: "PhoneNumberFromText",
  description:
    "Entered phone number text decoded to a valid phone number in E.164 form.",
});

/**
 * A phone number written for reading, in international format such as
 * `+420 777 123 456`. parsePhoneNumber reads it back as the same number.
 */
export const formatPhoneNumber = (phone: PhoneNumber): string =>
  parsePhoneNumberWithError(phone).formatInternational();

/** A phone number split into its country calling code and national number. */
export type PhoneNumberParts = {
  readonly countryCallingCode: string;
  readonly nationalNumber: string;
};

/** The country calling code and national number of a phone number. */
export const phoneNumberParts = (phone: PhoneNumber): PhoneNumberParts => {
  const parsed = parsePhoneNumberWithError(phone);
  return {
    countryCallingCode: parsed.countryCallingCode,
    nationalNumber: parsed.nationalNumber,
  };
};
