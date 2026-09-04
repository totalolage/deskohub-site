import { normalizePhoneNumber } from "@deskohub/dotypos";
import { Schema } from "effect";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";

const trimmedRequiredText = (maximumLength: number) =>
  Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(maximumLength));

const trimmedOptionalText = (maximumLength: number) =>
  Schema.optional(Schema.Trim.check(Schema.isMaxLength(maximumLength)));

export const customerProfileNameFieldSchema = trimmedRequiredText(100);

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

export type CustomerProfileAddressInput = {
  readonly addressLine1?: string;
  readonly addressLine2?: string;
  readonly city?: string;
  readonly zip?: string;
  readonly country?: string;
};

export const customerProfileBillingSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("personal"),
    ...customerProfileAddressFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("business"),
    ...customerProfileAddressFields,
    companyName: trimmedRequiredText(200),
    companyId: trimmedOptionalText(32),
    vatId: trimmedOptionalText(32),
  }),
]);

export type CustomerProfileBillingInput =
  typeof customerProfileBillingSchema.Type;

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

export type CustomerReservationSummary = {
  readonly id: string;
  readonly product: CustomerReservationProduct;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
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

const toInstantOrNull = (value: string): Temporal.Instant | null => {
  try {
    return Temporal.Instant.from(value);
  } catch {
    return null;
  }
};

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
    const end = reservation.endsAt ? toInstantOrNull(reservation.endsAt) : null;
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
