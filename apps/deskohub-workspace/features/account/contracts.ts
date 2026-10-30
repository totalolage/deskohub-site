import { normalizePhoneNumber } from "@deskohub/dotypos/phone-number";
import { Option, Schema } from "effect";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

const trimmedRequiredText = (maximumLength: number) =>
  Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(maximumLength));

const trimmedOptionalText = (maximumLength: number) =>
  Schema.optional(Schema.Trim.check(Schema.isMaxLength(maximumLength)));

const customerProfileNameFieldSchema = trimmedRequiredText(100);

/**
 * Dotypos owns the stored phone, so a blank value only means "clear the
 * field". A nonblank value the provider normalizer cannot parse is rejected
 * at this boundary: accepting it would let a profile save silently clear the
 * phone, including a legacy stored value that the user was merely rendering
 * back. The form therefore forces an explicit correction or an explicit
 * clearing.
 */
const customerProfilePhoneFieldSchema = Schema.Trim.check(
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
 * contract validates saved billing input against them, and the ARES mapper
 * decodes registry values through the same schemas so both paths share one
 * definition of trimming and maximum length.
 */
const customerProfileBusinessBillingSchema = Schema.Struct({
  ...customerProfileAddressFields,
  companyName: trimmedRequiredText(200),
  companyId: trimmedOptionalText(32),
  vatId: trimmedOptionalText(32),
});

export const customerProfileBusinessBillingFields =
  customerProfileBusinessBillingSchema.fields;

const customerProfileBillingSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("personal"),
    ...customerProfileAddressFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("business"),
    ...customerProfileBusinessBillingFields,
  }),
]);

/** A customer's billing details as read from Dotypos. */
type CustomerProfileBilling = {
  readonly kind: "personal" | "business";
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly city: string | null;
  readonly zip: string | null;
  readonly country: string | null;
  readonly companyName: string | null;
  readonly companyId: string | null;
  readonly vatId: string | null;
};

/** A customer's profile as read from Dotypos. */
export type CustomerProfile = {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string | null;
  readonly billing: CustomerProfileBilling | null;
};

/**
 * Dotypos owns the customer profile, so the login email is deliberately
 * absent from the profile input: the verified email is the immutable
 * reservation-linking trust boundary and is never an editable field.
 */
export const updateCustomerProfileSchema = Schema.Struct({
  firstName: customerProfileNameFieldSchema,
  lastName: trimmedOptionalText(100),
  phone: Schema.optional(customerProfilePhoneFieldSchema),
  billing: Schema.optional(customerProfileBillingSchema),
});

export const updateCustomerProfileStandardSchema = Schema.toStandardSchemaV1(
  updateCustomerProfileSchema,
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

export type CustomerProfileInput = typeof updateCustomerProfileSchema.Type;

/**
 * First-time completion may also carry the referral code the new customer was
 * invited with. Profile updates keep the plain profile contract, so an
 * established account can never submit one. `prefilledReferralCode` is the
 * code the form was prefilled with from the shared link; a submitted code
 * equal to it came from the link rather than from typing.
 */
export const completeCustomerProfileSchema = Schema.Struct({
  ...updateCustomerProfileSchema.fields,
  referralCode: trimmedOptionalText(64),
  prefilledReferralCode: trimmedOptionalText(64),
});

export const completeCustomerProfileStandardSchema = Schema.toStandardSchemaV1(
  completeCustomerProfileSchema,
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

export type CustomerProfileCompletionInput =
  typeof completeCustomerProfileSchema.Type;

/**
 * What happened to the referral code entered at first-time completion. A
 * pending code is retried on a later account visit.
 */
export type ProfileCompletionReferralOutcome =
  | { readonly status: "applied" }
  | { readonly status: "pending" }
  | {
      readonly status: "not-applied";
      readonly reason:
        | "already-referred"
        | "not-eligible"
        | "code-unusable"
        | "profile-already-completed";
    };

export type CustomerReservationStatus =
  | "cancelled"
  | "confirmed"
  | "pending"
  | "requires-attention";

export type CustomerReservationProduct =
  | { readonly kind: "cowork"; readonly tier: WorkspaceCoworkProductTier }
  | { readonly kind: "meeting-room" }
  | { readonly kind: "office" }
  | { readonly kind: "other" };

/**
 * The other party of a reservation in the account history: the customer the
 * account booked it for, or the account that booked it for the account's own
 * customer. A name that could not be read is null, and a deleted author is
 * never named.
 */
export type CustomerReservationParty =
  | { readonly kind: "booked-for"; readonly customerName: string | null }
  | { readonly kind: "booked-by"; readonly authorName: string | null }
  | { readonly kind: "booked-by-deleted-account" };

export type CustomerReservationSummary = {
  readonly id: string;
  readonly workspaceReservationId?: WorkspaceReservationId;
  /**
   * Marks a review account's sample or simulated hold: it has a status page
   * but never an access code.
   */
  readonly reviewSandbox?: true;
  /** Absent when the account's own customer booked it for itself. */
  readonly party?: CustomerReservationParty;
  readonly product: CustomerReservationProduct;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  /**
   * When the customer of a meeting room booked with early setup may arrive,
   * before `startsAt`.
   */
  readonly setupStartsAt?: string;
  readonly seats: number | null;
  readonly status: CustomerReservationStatus;
};

export type CustomerReservationGroups = {
  readonly current: readonly CustomerReservationSummary[];
  readonly past: readonly CustomerReservationSummary[];
  readonly unavailable: readonly CustomerReservationSummary[];
};

export type CustomerReservationHistory =
  | { readonly kind: "available"; readonly groups: CustomerReservationGroups }
  | {
      readonly kind: "unavailable";
      readonly reason:
        | "email-unverified"
        | "link-required"
        | "provider-unavailable";
    };

export type CustomerAvatarPresentation =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "available";
      readonly avatar: {
        readonly url: string;
        readonly version?: number;
      } | null;
    };

/**
 * Whether the account page offers deletion: `pending` once it is requested
 * and retryable, `withheld` for a review account or while that can't be
 * ruled out.
 */
export type AccountDeletion = "offered" | "pending" | "withheld";

const parseInstant = Option.liftThrowable((value: string) =>
  Temporal.Instant.from(value)
);

/**
 * Groups a customer's reservations for the account history. Cancelled
 * reservations always count as past, a reservation is current until its exact
 * end instant, and a missing or unparseable end date leaves the reservation
 * undated in the unavailable group instead of crashing the page.
 */
export const groupCustomerReservations = (
  reservations: readonly CustomerReservationSummary[],
  now: Temporal.Instant = Temporal.Now.instant()
): CustomerReservationGroups => {
  const current: CustomerReservationSummary[] = [];
  const past: CustomerReservationSummary[] = [];
  const unavailable: CustomerReservationSummary[] = [];

  for (const reservation of reservations) {
    const end = reservation.endsAt
      ? Option.getOrNull(parseInstant(reservation.endsAt))
      : null;
    if (!end) {
      unavailable.push(reservation);
    } else if (
      reservation.status === "cancelled" ||
      Temporal.Instant.compare(end, now) <= 0
    ) {
      past.push(reservation);
    } else {
      current.push(reservation);
    }
  }
  return { current, past, unavailable };
};
