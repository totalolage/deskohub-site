import type { DotyposCustomerBillingDetails } from "@deskohub/dotypos";
import { Effect, Match, Schema } from "effect";
import {
  type BusinessInvoiceBuyer,
  businessInvoiceBuyerSchema,
  type InvoiceBuyer,
  invoiceBuyerAddressSchema,
} from "@/features/accounting/billing-identity";

export const reservationPurposeSchema = Schema.Literals([
  "personal",
  "business",
]);
export type ReservationPurpose = typeof reservationPurposeSchema.Type;

export const reservationBillingSelectionSchema = Schema.Union([
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("none"),
  }),
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("requested"),
    address: invoiceBuyerAddressSchema,
  }),
  Schema.Struct({
    purpose: Schema.Literal("business"),
    invoice: Schema.Literal("required"),
    buyer: businessInvoiceBuyerSchema,
  }),
]).annotate({
  identifier: "ReservationBillingSelection",
  description:
    "Customer-declared reservation purpose and its immutable invoice instruction.",
});

export type ReservationBillingSelection =
  typeof reservationBillingSelectionSchema.Type;
export type ReservationBillingSelectionInput =
  typeof reservationBillingSelectionSchema.Encoded;

export const defaultReservationBillingSelection = {
  purpose: "personal",
  invoice: "none",
} as const satisfies ReservationBillingSelection;

export const reservationBillingSelectionInputSchema =
  reservationBillingSelectionSchema.pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed(defaultReservationBillingSelection)
    ),
    Schema.withConstructorDefault(
      Effect.succeed(defaultReservationBillingSelection)
    )
  );

export const normalizedReservationBillingSelectionSchema = Schema.toType(
  reservationBillingSelectionSchema
).pipe(
  Schema.withDecodingDefaultKey(
    Effect.succeed(defaultReservationBillingSelection)
  ),
  Schema.withConstructorDefault(
    Effect.succeed(defaultReservationBillingSelection)
  )
);

export const emptyRequestedPersonalBillingSelection = {
  purpose: "personal",
  invoice: "requested",
  address: { line1: "", city: "", postalCode: "", country: "CZ" },
} as const satisfies ReservationBillingSelectionInput;

export const emptyBusinessBillingSelection = {
  purpose: "business",
  invoice: "required",
  buyer: {
    kind: "business",
    legalName: "",
    companyId: "",
    address: { line1: "", city: "", postalCode: "", country: "CZ" },
  },
} as const satisfies ReservationBillingSelectionInput;

export const getReservationInvoiceBuyer = (input: {
  readonly billing: ReservationBillingSelection;
  readonly customerName: string;
}): InvoiceBuyer | undefined =>
  Match.value(input.billing).pipe(
    Match.when({ purpose: "personal", invoice: "none" }, () => undefined),
    Match.when(
      { purpose: "personal", invoice: "requested" },
      ({ address }) => ({
        kind: "person" as const,
        legalName: input.customerName,
        address,
      })
    ),
    Match.when({ purpose: "business" }, ({ buyer }) => buyer),
    Match.exhaustive
  );

export const getDotyposCustomerBillingDetails = (
  billing: ReservationBillingSelection
): DotyposCustomerBillingDetails | undefined =>
  Match.value(billing).pipe(
    Match.when({ purpose: "personal", invoice: "none" }, () => undefined),
    Match.when(
      { purpose: "personal", invoice: "requested" },
      ({ address }) => ({
        addressLine1: address.line1,
        addressLine2: address.line2 ?? "",
        city: address.city,
        zip: address.postalCode,
        country: address.country,
        companyName: "",
        companyId: "",
        vatId: "",
      })
    ),
    Match.when(
      { purpose: "business" },
      ({ buyer }: { readonly buyer: BusinessInvoiceBuyer }) => ({
        addressLine1: buyer.address.line1,
        addressLine2: buyer.address.line2 ?? "",
        city: buyer.address.city,
        zip: buyer.address.postalCode,
        country: buyer.address.country,
        companyName: buyer.legalName,
        companyId: buyer.companyId,
        vatId: buyer.vatId ?? "",
      })
    ),
    Match.exhaustive
  );
