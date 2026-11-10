import {
  baseLocale,
  getLocaleDefinition,
  isSupportedLocale,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { parsePhoneNumber, phoneNumberSchema } from "@deskohub/phone-number";
import { Option, Schema, type SchemaAST } from "effect";

/**
 * Every customer API payload reports all of its issues and refuses fields it
 * doesn't know, the same way the Workspace's account actions validate. The
 * profile schemas themselves carry no parse options, because the browser
 * profile form decodes them with its own.
 */
export const customerInputParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const satisfies SchemaAST.ParseOptions;

const trimmedRequiredText = (maximumLength: number) =>
  Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(maximumLength));

const trimmedOptionalText = (maximumLength: number) =>
  Schema.optional(Schema.Trim.check(Schema.isMaxLength(maximumLength)));

/**
 * Dotypos owns the stored phone, so a blank value only means "clear the
 * field". Any other value must hold a phone number, and one without is
 * rejected at this boundary: accepting it would let a profile save silently
 * clear the phone, including a legacy stored value that the user was merely
 * rendering back. The form therefore forces an explicit correction or an
 * explicit clearing.
 *
 * Clients and the form send the phone as entered text, which this field keeps.
 * A number without a country calling code is read in one of `phoneRegions`.
 */
const phoneTextReadIn = (phoneRegions: ReadonlyArray<string>) =>
  Schema.Trim.check(
    Schema.isMaxLength(32),
    Schema.makeFilter((value: string): boolean | string =>
      value === "" ||
      phoneRegions.some((region) =>
        Option.isSome(parsePhoneNumber(value, region))
      )
        ? true
        : "Invalid phone number"
    )
  );

/** The entered phone, a number without a calling code read in the region. */
const customerProfilePhoneText = (defaultPhoneRegion: string) =>
  phoneTextReadIn([defaultPhoneRegion]);

/** The Workspace's reading of the entered phone: blank, or its phone number. */
const customerProfilePhoneNumber = (defaultPhoneRegion: string) =>
  customerProfilePhoneText(defaultPhoneRegion).pipe(
    Schema.decodeTo(
      Schema.Union([Schema.Literal(""), phoneNumberSchema(defaultPhoneRegion)])
    )
  );

const customerProfileAddressFields = {
  addressLine1: trimmedOptionalText(200),
  addressLine2: trimmedOptionalText(200),
  city: trimmedOptionalText(100),
  zip: trimmedOptionalText(20),
  country: trimmedOptionalText(2),
} as const;

/**
 * The single source of the business billing field schemas: the profile
 * contract validates saved billing input against them, and the Workspace's
 * ARES mapper decodes registry values through the same schemas so both paths
 * share one definition of trimming and maximum length.
 */
const CustomerProfileBusinessBillingInput = Schema.Struct({
  ...customerProfileAddressFields,
  companyName: trimmedRequiredText(200),
  companyId: trimmedOptionalText(32),
  vatId: trimmedOptionalText(32),
});

export const customerProfileBusinessBillingFields =
  CustomerProfileBusinessBillingInput.fields;

const CustomerProfileBillingInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("personal"),
    ...customerProfileAddressFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("business"),
    ...customerProfileBusinessBillingFields,
  }),
]);

const customerProfileFields = <Phone extends Schema.Top>(phone: Phone) => ({
  firstName: trimmedRequiredText(100),
  lastName: trimmedOptionalText(100),
  phone: Schema.optional(phone),
  billing: Schema.optional(CustomerProfileBillingInput),
});

/**
 * First-time completion may also carry the referral code the new customer was
 * invited with. Profile updates keep the plain profile contract, so an
 * established account can never submit one. `prefilledReferralCode` is the
 * code the form was prefilled with from the shared link; a submitted code
 * equal to it came from the link rather than from typing.
 */
const profileCompletionReferralFields = {
  referralCode: trimmedOptionalText(64),
  prefilledReferralCode: trimmedOptionalText(64),
};

/**
 * The profile schemas for a phone entered in a default phone region, an
 * ISO 3166-1 alpha-2 code such as `DE`: a phone number without a country
 * calling code is read in that region, and one with it in any region.
 *
 * Dotypos owns the customer profile, so the login email is deliberately
 * absent from the profile input: the verified email is the immutable
 * reservation-linking trust boundary and is never an editable field.
 *
 * - `input` is the profile as a client sends it, with the phone as entered
 *   text, and `completionInput` the first-time completion.
 * - `save` is the profile save the Workspace reads from an `input`: the same
 *   rules, with the entered phone decoded to its phone number, and
 *   `completionSave` the first-time completion it reads.
 */
export const customerProfileSchemas = (defaultPhoneRegion: string) => {
  const input = Schema.Struct(
    customerProfileFields(customerProfilePhoneText(defaultPhoneRegion))
  );
  const save = Schema.Struct(
    customerProfileFields(customerProfilePhoneNumber(defaultPhoneRegion))
  );
  return {
    input,
    completionInput: Schema.Struct({
      ...input.fields,
      ...profileCompletionReferralFields,
    }),
    save,
    completionSave: Schema.Struct({
      ...save.fields,
      ...profileCompletionReferralFields,
    }),
  };
};

/**
 * The phone region of a signed-in account's profile: the region of the
 * account's saved language, or the base locale's when it has none or one
 * this build doesn't serve. The Workspace reads the account's profile saves
 * in it, and a client that validates the profile first reads the account's
 * `locale` the same way, so both read an entered phone alike.
 */
export const accountPhoneRegion = (accountLocale: string | null): string =>
  getLocaleDefinition(
    accountLocale !== null && isSupportedLocale(accountLocale)
      ? accountLocale
      : baseLocale
  ).phoneRegion;

/** The profile schemas of a signed-in account with this saved language. */
export const accountProfileSchemas = (accountLocale: string | null) =>
  customerProfileSchemas(accountPhoneRegion(accountLocale));

type CustomerProfileSchemas = ReturnType<typeof customerProfileSchemas>;

/**
 * The profile as a client of the customer API sends it. The API reads the
 * payload before it knows the account, so its phone need only hold a phone
 * number in the phone region of some locale the Workspace serves; the
 * Workspace then reads it in the account's phone region
 * (`accountProfileSchemas`).
 */
export const CustomerProfileInput = Schema.Struct(
  customerProfileFields(
    phoneTextReadIn([
      ...new Set(
        supportedLocales.map(
          (locale) => getLocaleDefinition(locale).phoneRegion
        )
      ),
    ])
  )
);
export type CustomerProfileInput = typeof CustomerProfileInput.Type;

/** The first-time completion as a client of the customer API sends it. */
export const CustomerProfileCompletionInput = Schema.Struct({
  ...CustomerProfileInput.fields,
  ...profileCompletionReferralFields,
});
export type CustomerProfileCompletionInput =
  typeof CustomerProfileCompletionInput.Type;

/** The profile save the Workspace reads from a `CustomerProfileInput`. */
export type CustomerProfileSave = CustomerProfileSchemas["save"]["Type"];

/**
 * The first-time completion the Workspace reads from a
 * `CustomerProfileCompletionInput`.
 */
export type CustomerProfileCompletionSave =
  CustomerProfileSchemas["completionSave"]["Type"];

const storedText = Schema.NullOr(Schema.String);

/** A customer's billing details as read from Dotypos. */
export const CustomerProfileBilling = Schema.Struct({
  kind: Schema.Literals(["personal", "business"]),
  addressLine1: storedText,
  addressLine2: storedText,
  city: storedText,
  zip: storedText,
  country: storedText,
  companyName: storedText,
  companyId: storedText,
  vatId: storedText,
}).annotate({ identifier: "CustomerProfileBilling" });
export type CustomerProfileBilling = typeof CustomerProfileBilling.Type;

/** A customer's profile as read from Dotypos. */
export const CustomerProfile = Schema.Struct({
  firstName: Schema.String,
  lastName: storedText,
  phone: storedText,
  billing: Schema.NullOr(CustomerProfileBilling),
}).annotate({ identifier: "CustomerProfile" });
export type CustomerProfile = typeof CustomerProfile.Type;

/**
 * What happened to the referral code entered at first-time completion. A
 * pending code is retried on a later account visit.
 */
export const ProfileCompletionReferralOutcome = Schema.Union([
  Schema.Struct({ status: Schema.Literal("applied") }),
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({
    status: Schema.Literal("not-applied"),
    reason: Schema.Literals([
      "already-referred",
      "not-eligible",
      "code-unusable",
      "profile-already-completed",
    ]),
  }),
]).annotate({ identifier: "ProfileCompletionReferralOutcome" });
export type ProfileCompletionReferralOutcome =
  typeof ProfileCompletionReferralOutcome.Type;
