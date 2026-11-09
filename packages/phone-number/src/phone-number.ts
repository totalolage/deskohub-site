import { Effect, Option, Schema, SchemaGetter, SchemaIssue } from "effect";
import {
  type CountryCode,
  isSupportedCountry,
  isValidPhoneNumber,
  parsePhoneNumberWithError,
} from "libphonenumber-js";

/**
 * Whether a region, an ISO 3166-1 alpha-2 code such as `CZ`, has a numbering
 * plan that reads a number entered without an international prefix.
 */
export const isPhoneRegion = (region: string): boolean =>
  isSupportedCountry(region);

/**
 * The numbering plan of a default region. A region without one, such as an
 * unknown code, reads only a number with a leading `+`.
 */
const numberingPlan = (defaultRegion: string): CountryCode | undefined =>
  isSupportedCountry(defaultRegion) ? defaultRegion : undefined;

const parseText = Option.liftThrowable(
  (text: string, plan: CountryCode | undefined) =>
    parsePhoneNumberWithError(text, plan)
);

/**
 * The E.164 form of the valid number a text holds. The number may sit inside
 * other text, such as a label, and an extension is dropped. Blank text, text
 * without a number, and a number no numbering plan allows have none.
 */
const toE164 = (
  text: string,
  plan: CountryCode | undefined
): Option.Option<string> =>
  parseText(text.trim(), plan).pipe(
    Option.filter((parsed) => parsed.isValid()),
    Option.map((parsed) => parsed.format("E.164"))
  );

const E164PhoneNumberSchema = Schema.String.check(
  Schema.makeFilter(
    (value: string) => Option.contains(toE164(value, undefined), value),
    { message: "must be a valid phone number in E.164 form" }
  )
)
  .pipe(Schema.brand("PhoneNumber"))
  .annotate({
    identifier: "PhoneNumber",
    description: "A valid phone number in E.164 form, such as +420777123456.",
  });

/** A valid phone number in E.164 form, such as `+420777123456`. */
export type PhoneNumber = typeof E164PhoneNumberSchema.Type;

/**
 * The phone number a text holds. A number without a leading `+` is read in
 * the default region, an ISO 3166-1 alpha-2 code such as `CZ`, including a
 * dialing prefix such as `00`, which differs between regions; a region
 * without a numbering plan reads none of them. A number with a leading `+` is
 * read the same in every region. Text around the number, such as a label, is
 * ignored, and an extension is dropped. Blank or unreadable text and an
 * invalid number have none.
 */
export const parsePhoneNumber = (
  text: string,
  defaultRegion: string
): Option.Option<PhoneNumber> =>
  Option.map(toE164(text, numberingPlan(defaultRegion)), (value) =>
    E164PhoneNumberSchema.make(value)
  );

/**
 * Whether the whole text, apart from surrounding whitespace, is one valid
 * phone number, read in the default region as parsePhoneNumber reads it.
 * Unlike parsePhoneNumber, any other text around the number fails it.
 */
export const isPhoneNumber = (text: string, defaultRegion: string): boolean =>
  isValidPhoneNumber(text.trim(), numberingPlan(defaultRegion));

/**
 * Decodes text entered in the default region to the phone number
 * parsePhoneNumber reads from it, and encodes a phone number as its E.164
 * text.
 */
export const phoneNumberSchema = (defaultRegion: string) =>
  Schema.String.pipe(
    Schema.decodeTo(E164PhoneNumberSchema, {
      decode: SchemaGetter.transformOrFail((text: string) =>
        Option.match(parsePhoneNumber(text, defaultRegion), {
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
 * `+420 777 123 456`. Its leading `+` makes parsePhoneNumber read it back as
 * the same number in every region.
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
