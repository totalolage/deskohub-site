import { normalizePhoneNumber } from "@deskohub/dotypos/phone-number";
import { Schema, type SchemaAST } from "effect";

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
 * field". A nonblank value the provider normalizer cannot parse is rejected
 * at this boundary: accepting it would let a profile save silently clear the
 * phone, including a legacy stored value that the user was merely rendering
 * back. The form therefore forces an explicit correction or an explicit
 * clearing.
 */
const customerProfilePhoneField = Schema.Trim.check(
  Schema.isMaxLength(32),
  Schema.makeFilter((value: string): boolean | string =>
    value === "" || normalizePhoneNumber(value) != null
      ? true
      : "Invalid phone number"
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

/**
 * Dotypos owns the customer profile, so the login email is deliberately
 * absent from the profile input: the verified email is the immutable
 * reservation-linking trust boundary and is never an editable field.
 */
export const CustomerProfileInput = Schema.Struct({
  firstName: trimmedRequiredText(100),
  lastName: trimmedOptionalText(100),
  phone: Schema.optional(customerProfilePhoneField),
  billing: Schema.optional(CustomerProfileBillingInput),
});
export type CustomerProfileInput = typeof CustomerProfileInput.Type;

/**
 * First-time completion may also carry the referral code the new customer was
 * invited with. Profile updates keep the plain profile contract, so an
 * established account can never submit one. `prefilledReferralCode` is the
 * code the form was prefilled with from the shared link; a submitted code
 * equal to it came from the link rather than from typing.
 */
export const CustomerProfileCompletionInput = Schema.Struct({
  ...CustomerProfileInput.fields,
  referralCode: trimmedOptionalText(64),
  prefilledReferralCode: trimmedOptionalText(64),
});
export type CustomerProfileCompletionInput =
  typeof CustomerProfileCompletionInput.Type;

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
