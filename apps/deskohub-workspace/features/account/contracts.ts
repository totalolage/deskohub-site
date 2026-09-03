import { Schema } from "effect";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";

const trimmedRequiredText = (maximumLength: number) =>
  Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(maximumLength));

const trimmedOptionalText = (maximumLength: number) =>
  Schema.optional(Schema.Trim.check(Schema.isMaxLength(maximumLength)));

export const customerProfileNameFieldSchema = trimmedRequiredText(100);

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
  phone: trimmedOptionalText(32),
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
