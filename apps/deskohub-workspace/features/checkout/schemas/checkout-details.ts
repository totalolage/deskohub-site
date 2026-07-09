import { Data, Schema as EffectSchema, Match } from "effect";
import { checkoutSummarySectionEffectSchema } from "@/features/checkout/schemas/checkout-summary";
import { nonNegativeWorkspaceMoneyEffectSchema } from "@/features/checkout/workspace-money";
import { locales } from "@/features/i18n";
import {
  getReservationIntervalValidationIssue,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import { getReservationProductRuleIssue } from "@/features/reservation/schemas/reservation-product-rules";
import { makeWorkspaceReservationDetailsEffectSchema } from "@/features/reservation/schemas/stored-reservation-details";
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

const getCheckoutDetailsReservationIssues = (
  reservation: CheckoutDetailsReservationDraft
) => {
  const intervalIssue = getReservationIntervalValidationIssue(reservation);
  if (intervalIssue) {
    return [
      {
        path: [intervalIssue.path],
        issue: intervalIssue.message,
      },
    ];
  }

  const productRuleIssue = getReservationProductRuleIssue(reservation);
  if (productRuleIssue) {
    return [
      {
        path: [
          productRuleIssue.path === "entryTier"
            ? "tier"
            : productRuleIssue.path,
        ],
        issue: productRuleIssue.message,
      },
    ];
  }

  return [];
};

const checkoutDetailsReservationEffectSchema =
  CheckoutDetailsReservationShapeSchema.check(
    EffectSchema.makeFilter(getCheckoutDetailsReservationIssues)
  );

const checkoutDetailsReservationEffectParser = makeEffectSchemaParser(
  checkoutDetailsReservationEffectSchema
);

const normalizeCheckoutDetailsReservation = (
  reservation: CheckoutDetailsReservationDraft
) =>
  Match.value(reservation).pipe(
    Match.tag("meeting-room", (meetingRoomReservation) => {
      const normalized = unsafeNormalizeReservationInterval(
        meetingRoomReservation
      );
      return {
        _tag: "meeting-room" as const,
        startsAt: normalized.startsAt,
        endsAt: normalized.endsAt,
      };
    }),
    Match.tag("cowork", (coworkReservation) =>
      Match.value(coworkReservation).pipe(
        Match.when({ tier: "basic" }, (basicReservation) => {
          const normalized =
            unsafeNormalizeReservationInterval(basicReservation);
          return {
            _tag: "cowork" as const,
            tier: "basic" as const,
            startsAt: normalized.startsAt,
            endsAt: normalized.endsAt,
            coffee: basicReservation.coffee,
          };
        }),
        Match.when({ tier: "plus" }, (plusReservation) => {
          const normalized =
            unsafeNormalizeReservationInterval(plusReservation);
          return {
            _tag: "cowork" as const,
            tier: "plus" as const,
            startsAt: normalized.startsAt,
            endsAt: normalized.endsAt,
            coffee: true as const,
          };
        }),
        Match.when({ tier: "profi" }, (profiReservation) => {
          const normalized =
            unsafeNormalizeReservationInterval(profiReservation);
          return {
            _tag: "cowork" as const,
            tier: "profi" as const,
            startsAt: normalized.startsAt,
            endsAt: normalized.endsAt,
            coffee: true as const,
            monitorOption: profiReservation.monitorOption,
          };
        }),
        Match.exhaustive
      )
    ),
    Match.exhaustive
  );

type CheckoutDetailsReservation = ReturnType<
  typeof normalizeCheckoutDetailsReservation
>;

export const checkoutDetailsReservationSchema = {
  parse: (input: unknown): CheckoutDetailsReservation =>
    normalizeCheckoutDetailsReservation(
      checkoutDetailsReservationEffectParser.parse(input)
    ),
  safeParse: (input: unknown) => {
    try {
      return {
        success: true as const,
        data: checkoutDetailsReservationSchema.parse(input),
      };
    } catch (error) {
      return { success: false as const, error };
    }
  },
};

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
  schema: EffectSchema.Literal("workspace-checkout-details"),
  schemaVersion: EffectSchema.Literal(1),
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

type CheckoutDetailsJsonDraft = typeof checkoutDetailsJsonEffectSchema.Type;

export type CheckoutDetailsJson = Omit<
  CheckoutDetailsJsonDraft,
  "reservation"
> & {
  readonly reservation: CheckoutDetailsReservation;
};

const checkoutDetailsJsonEffectParser = makeEffectSchemaParser(
  checkoutDetailsJsonEffectSchema
);

const normalizeCheckoutDetailsJson = (
  details: CheckoutDetailsJsonDraft
): CheckoutDetailsJson => ({
  ...details,
  reservation: normalizeCheckoutDetailsReservation(details.reservation),
});

export const checkoutDetailsJsonSchema = {
  parse: (input: unknown): CheckoutDetailsJson =>
    normalizeCheckoutDetailsJson(checkoutDetailsJsonEffectParser.parse(input)),
  safeParse: (input: unknown) => {
    try {
      return {
        success: true as const,
        data: checkoutDetailsJsonSchema.parse(input),
      };
    } catch (error) {
      return { success: false as const, error };
    }
  },
};
