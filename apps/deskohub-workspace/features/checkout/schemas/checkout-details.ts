import { Match, Schema } from "effect";
import { checkoutSummarySchema } from "@/features/checkout/checkout-quote";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import { appliedDiscountCodec } from "@/features/discounts/contracts";
import { locales } from "@/features/i18n";
import type { NormalizedCoworkReservationOrder } from "@/features/reservation/cowork-reservation";
import {
  normalizedBasicCoworkReservationProductSchema,
  normalizedPlusCoworkReservationProductSchema,
  normalizedProfiCoworkReservationProductSchema,
} from "@/features/reservation/cowork-reservation-product";
import {
  instantStringSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

export const legalDocumentKeys = [
  "termsAndConditions",
  "operatingRules",
  "privacyPolicy",
] as const;

export type LegalDocumentKey = (typeof legalDocumentKeys)[number];

export const legalEvidenceSources = [
  "reservation_submit",
  "payment_submit",
] as const;

export const reservationSubmitLegalEvidenceSource = legalEvidenceSources[0];
export const paymentSubmitLegalEvidenceSource = legalEvidenceSources[1];

const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());

export const legalDocumentHashSchema = Schema.Struct({
  path: nonEmptyStringSchema,
  hash: nonEmptyStringSchema,
  hashAlgorithm: Schema.Literal("sha256"),
});

export type LegalDocumentHash = typeof legalDocumentHashSchema.Type;

export const legalEvidenceSchema = Schema.Struct({
  documentKey: Schema.Literals(legalDocumentKeys),
  documentHash: nonEmptyStringSchema,
  accepted: Schema.Boolean,
  acceptedAt: Schema.toEncoded(instantStringSchema),
  locale: Schema.Literals(locales),
  source: nonEmptyStringSchema,
  document: legalDocumentHashSchema,
  acknowledgements: Schema.optional(
    Schema.Record(nonEmptyStringSchema, Schema.Boolean)
  ),
}).check(
  Schema.makeFilter((evidence) =>
    evidence.document.hash === evidence.documentHash
      ? true
      : {
          path: ["documentHash"],
          issue: "Legal evidence documentHash must match document.hash.",
        }
  )
);

export type LegalEvidence = typeof legalEvidenceSchema.Type;

export const legalEvidenceMapSchema = Schema.Record(
  nonEmptyStringSchema,
  legalEvidenceSchema
).check(
  Schema.makeFilter((evidenceMap) => {
    for (const [documentHash, evidence] of Object.entries(evidenceMap)) {
      if (documentHash !== evidence.documentHash) {
        return {
          path: [documentHash, "documentHash"],
          issue: "Legal evidence map key must match evidence.documentHash.",
        };
      }
    }

    return true;
  })
);

export type LegalEvidenceMap = typeof legalEvidenceMapSchema.Type;

const checkoutReservationDateSchema = Schema.toEncoded(plainDateStringSchema);

const basicCheckoutReservationDetailsSchema = Schema.Struct({
  ...normalizedBasicCoworkReservationProductSchema.fields,
  date: checkoutReservationDateSchema,
});

const plusCheckoutReservationDetailsSchema = Schema.Struct({
  ...normalizedPlusCoworkReservationProductSchema.fields,
  date: checkoutReservationDateSchema,
});

const profiCheckoutReservationDetailsSchema = Schema.Struct({
  ...normalizedProfiCoworkReservationProductSchema.fields,
  date: checkoutReservationDateSchema,
});

export const checkoutReservationDetailsSchema = Schema.Union([
  basicCheckoutReservationDetailsSchema,
  plusCheckoutReservationDetailsSchema,
  profiCheckoutReservationDetailsSchema,
]).annotate({
  identifier: "CheckoutReservationDetails",
  description:
    "PII-free cowork reservation projection used by checkout providers.",
});

export type CheckoutReservationDetails =
  typeof checkoutReservationDetailsSchema.Type;

export const getCheckoutReservationDetails = (
  reservation: NormalizedCoworkReservationOrder
): CheckoutReservationDetails =>
  Match.value(reservation).pipe(
    Match.when({ entryTier: "basic" }, (basicReservation) =>
      basicCheckoutReservationDetailsSchema.make({
        entryTier: "basic",
        date: basicReservation.date,
        coffee: basicReservation.coffee,
      })
    ),
    Match.when({ entryTier: "plus" }, (plusReservation) =>
      plusCheckoutReservationDetailsSchema.make({
        entryTier: "plus",
        date: plusReservation.date,
        coffee: true,
      })
    ),
    Match.when({ entryTier: "profi" }, (profiReservation) =>
      profiCheckoutReservationDetailsSchema.make({
        entryTier: "profi",
        date: profiReservation.date,
        coffee: true,
        monitorOption: profiReservation.monitorOption,
      })
    ),
    Match.exhaustive
  );

// This transient snapshot contains only the booking, payment, and legal data
// required by provider adapters. Customer contact remains owned by Dotypos.
export const checkoutDetailsJsonSchema = Schema.Struct({
  schema: Schema.Literal("workspace-checkout-details"),
  schemaVersion: Schema.Literal(1),
  locale: Schema.Literals(locales),
  reservation: checkoutReservationDetailsSchema,
  payment: Schema.Struct({
    expectedPrice: nonNegativeWorkspaceMoneyCodec,
    undiscountedPrice: nonNegativeWorkspaceMoneyCodec,
    discounts: Schema.Array(appliedDiscountCodec),
    summary: checkoutSummarySchema,
    providerRedirectUrl: Schema.optional(Schema.URL),
  }),
  legal: legalEvidenceMapSchema,
}).annotate({
  identifier: "CheckoutDetails",
  description: "Transient PII-free checkout provider snapshot.",
});

export type CheckoutDetailsJson = typeof checkoutDetailsJsonSchema.Type;
