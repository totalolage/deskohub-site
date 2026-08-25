import { Schema } from "effect";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";

export const updateCustomerProfileSchema = Schema.Struct({
  name: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(100)),
});

export const updateCustomerProfileStandardSchema = Schema.toStandardSchemaV1(
  updateCustomerProfileSchema,
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

export const deleteCustomerAccountSchema = Schema.Struct({
  confirmed: Schema.Literal(true),
});

export const deleteCustomerAccountStandardSchema = Schema.toStandardSchemaV1(
  deleteCustomerAccountSchema,
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

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
