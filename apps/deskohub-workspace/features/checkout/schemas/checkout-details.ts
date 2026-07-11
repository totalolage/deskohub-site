import {
  Data,
  Effect,
  Schema as EffectSchema,
  Match,
  Option,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import { checkoutSummarySectionEffectSchema } from "@/features/checkout/schemas/checkout-summary";
import { nonNegativeWorkspaceMoneyEffectSchema } from "@/features/checkout/workspace-money";
import { locales } from "@/features/i18n";
import {
  getReservationDurationMinutes,
  getReservationIntervalValidationIssue,
  isDefaultReservationInterval,
  meetingRoomReservationDurationMinutesEffectSchema,
  normalizeReservationInterval,
  type ReservationInterval,
  unsafeNormalizeReservationInterval,
  wholeHourReservationInstantEffectSchema,
} from "@/features/reservation/schemas/reservation-interval";
import {
  makeWorkspaceReservationDetailsEffectSchema,
  type StoredCoworkReservationDetails,
  type StoredMeetingRoomReservationDetails,
} from "@/features/reservation/schemas/stored-reservation-details";
import {
  isoDateTimeWithOffsetStringEffectSchema,
  urlStringEffectSchema,
} from "@/shared/utils/effect-schema";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";

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

export const legalDocumentHashEffectSchema = EffectSchema.Struct({
  path: EffectSchema.NonEmptyString,
  hash: EffectSchema.NonEmptyString,
  hashAlgorithm: EffectSchema.Literal("sha256"),
});

export type LegalDocumentHash = typeof legalDocumentHashEffectSchema.Type;

export const legalDocumentHashSchema = makeEffectSchemaParser(
  legalDocumentHashEffectSchema
);

export const legalEvidenceEffectSchema = EffectSchema.Struct({
  documentKey: EffectSchema.Literals(legalDocumentKeys),
  documentHash: EffectSchema.NonEmptyString,
  accepted: EffectSchema.Boolean,
  acceptedAt: isoDateTimeWithOffsetStringEffectSchema,
  locale: EffectSchema.Literals(locales),
  source: EffectSchema.NonEmptyString,
  document: legalDocumentHashEffectSchema,
  acknowledgements: EffectSchema.optional(
    EffectSchema.Record(EffectSchema.NonEmptyString, EffectSchema.Boolean)
  ),
}).check(
  EffectSchema.makeFilter((evidence) => {
    if (evidence.document.hash !== evidence.documentHash) {
      return {
        path: ["documentHash"],
        issue: "Legal evidence documentHash must match document.hash.",
      };
    }

    return undefined;
  })
);

export type LegalEvidence = typeof legalEvidenceEffectSchema.Type;

export const legalEvidenceSchema = makeEffectSchemaParser(
  legalEvidenceEffectSchema
);

export const legalEvidenceMapEffectSchema = EffectSchema.Record(
  EffectSchema.NonEmptyString,
  legalEvidenceEffectSchema
).check(
  EffectSchema.makeFilter((evidenceMap) => {
    const issues = [];

    for (const [documentHash, evidence] of Object.entries(evidenceMap)) {
      if (documentHash !== evidence.documentHash) {
        issues.push({
          path: [documentHash, "documentHash"],
          issue: "Legal evidence map key must match evidence.documentHash.",
        });
      }
    }

    return issues;
  })
);

export type LegalEvidenceMap = typeof legalEvidenceMapEffectSchema.Type;

export const legalEvidenceMapSchema = makeEffectSchemaParser(
  legalEvidenceMapEffectSchema
);

export class CheckoutDetailsError extends Data.TaggedError(
  "CheckoutDetailsError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const CheckoutDetailsReservationShapeSchema =
  makeWorkspaceReservationDetailsEffectSchema({
    startsAt: EffectSchema.NonEmptyString,
    endsAt: EffectSchema.NonEmptyString,
  });

type CheckoutDetailsReservationDraft =
  typeof CheckoutDetailsReservationShapeSchema.Type;

type CheckoutDetailsCoworkReservationDraft = Extract<
  CheckoutDetailsReservationDraft,
  { readonly _tag: "cowork" }
>;

type CheckoutDetailsMeetingRoomReservationDraft = Extract<
  CheckoutDetailsReservationDraft,
  { readonly _tag: "meeting-room" }
>;

const isMeetingRoomReservationDuration = EffectSchema.is(
  meetingRoomReservationDurationMinutesEffectSchema
);
const isWholeHourReservationInstant = EffectSchema.is(
  wholeHourReservationInstantEffectSchema
);

const getCheckoutDetailsCoworkReservationIssue = (
  reservation: CheckoutDetailsCoworkReservationDraft
): EffectSchema.FilterIssue | undefined => {
  const interval = unsafeNormalizeReservationInterval(reservation);

  return isDefaultReservationInterval(interval)
    ? undefined
    : {
        path: ["endsAt"],
        issue: "Cowork reservations must use the full-day duration.",
      };
};

const getCheckoutDetailsMeetingRoomReservationIssue = (
  reservation: CheckoutDetailsMeetingRoomReservationDraft
): EffectSchema.FilterIssue | undefined => {
  const interval = unsafeNormalizeReservationInterval(reservation);

  if (!isWholeHourReservationInstant(interval.startsAt)) {
    return {
      path: ["startsAt"],
      issue: "Meeting room reservations must start on a whole hour.",
    };
  }

  if (
    !isMeetingRoomReservationDuration(getReservationDurationMinutes(interval))
  ) {
    return {
      path: ["endsAt"],
      issue: "Meeting room duration must be 1 hour, 4 hours, or 24 hours.",
    };
  }

  return undefined;
};

const getCheckoutDetailsReservationIssue = (
  reservation: CheckoutDetailsReservationDraft
): EffectSchema.FilterIssue | undefined => {
  const intervalIssue = getReservationIntervalValidationIssue(reservation);
  if (intervalIssue) {
    return {
      path: [intervalIssue.path],
      issue: intervalIssue.message,
    };
  }

  return Match.value(reservation).pipe(
    Match.tag("cowork", getCheckoutDetailsCoworkReservationIssue),
    Match.tag("meeting-room", getCheckoutDetailsMeetingRoomReservationIssue),
    Match.exhaustive
  );
};

const getCheckoutDetailsReservationIssues = (
  reservation: CheckoutDetailsReservationDraft
): readonly EffectSchema.FilterIssue[] => {
  const issue = getCheckoutDetailsReservationIssue(reservation);
  return issue ? [issue] : [];
};

const normalizeCheckoutDetailsReservation = (
  reservation: CheckoutDetailsReservationDraft
) =>
  normalizeReservationInterval(reservation).pipe(
    Effect.map((normalized) => ({
      ...reservation,
      startsAt: normalized.startsAt,
      endsAt: normalized.endsAt,
    }))
  );

const checkoutDetailsReservationDraftEffectSchema =
  CheckoutDetailsReservationShapeSchema.check(
    EffectSchema.makeFilter(getCheckoutDetailsReservationIssues)
  );

const checkoutDetailsReservationEffectSchema =
  checkoutDetailsReservationDraftEffectSchema.pipe(
    EffectSchema.decodeTo(CheckoutDetailsReservationShapeSchema, {
      decode: SchemaGetter.transformOrFail((reservation) =>
        normalizeCheckoutDetailsReservation(reservation).pipe(
          Effect.mapError(
            (error) =>
              new SchemaIssue.InvalidValue(Option.some(reservation), {
                message: error.message,
              })
          )
        )
      ),
      encode: SchemaGetter.transform(
        (reservation): CheckoutDetailsReservationDraft => reservation
      ),
    })
  );

export const checkoutDetailsReservationSchema = makeEffectSchemaParser(
  checkoutDetailsReservationEffectSchema
);

export type CheckoutDetailsReservation =
  typeof checkoutDetailsReservationEffectSchema.Type;

type CheckoutDetailsReservationInput =
  | StoredCoworkReservationDetails
  | (StoredMeetingRoomReservationDetails & ReservationInterval);

export const parseCheckoutDetailsReservation = (
  reservation: CheckoutDetailsReservationInput,
  interval: ReservationInterval
): CheckoutDetailsReservation =>
  checkoutDetailsReservationSchema.parse({
    ...reservation,
    startsAt: interval.startsAt,
    endsAt: interval.endsAt,
  });

const checkoutDetailsPaymentCustomerDiscountEffectSchema = EffectSchema.Struct({
  source: EffectSchema.Literal("dotypos-discount-group"),
  discountGroupId: EffectSchema.NonEmptyString,
  percent: EffectSchema.Finite.check(
    EffectSchema.isGreaterThan(0),
    EffectSchema.isLessThanOrEqualTo(100)
  ),
  amount: nonNegativeWorkspaceMoneyEffectSchema,
});

// This JSON is intentionally limited to booking, payment, legal, and fulfillment
// state. Customer name, email, and phone remain owned by Dotypos and must not be
// added here or as local database columns.
export const checkoutDetailsJsonEffectSchema = EffectSchema.Struct({
  locale: EffectSchema.Literals(locales),
  reservation: checkoutDetailsReservationEffectSchema,
  payment: EffectSchema.Struct({
    expectedPrice: nonNegativeWorkspaceMoneyEffectSchema,
    undiscountedPrice: EffectSchema.optional(
      nonNegativeWorkspaceMoneyEffectSchema
    ),
    summary: EffectSchema.Struct({
      sections: EffectSchema.Array(checkoutSummarySectionEffectSchema),
      total: nonNegativeWorkspaceMoneyEffectSchema,
    }),
    providerRedirectUrl: EffectSchema.optional(urlStringEffectSchema),
    customerDiscount: EffectSchema.optional(
      checkoutDetailsPaymentCustomerDiscountEffectSchema
    ),
  }),
  legal: legalEvidenceMapEffectSchema,
  fulfillment: EffectSchema.Struct({
    accessCodePolicy: EffectSchema.Literal("workspace-static-v1"),
  }),
});

export type CheckoutDetailsJson = typeof checkoutDetailsJsonEffectSchema.Type;

export const checkoutDetailsJsonSchema = makeEffectSchemaParser(
  checkoutDetailsJsonEffectSchema
);
