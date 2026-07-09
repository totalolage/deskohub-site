import { Data, Schema as EffectSchema, Match, Option } from "effect";
import { z } from "zod/v4";
import {
  type CheckoutSummarySection,
  isCheckoutSummarySection,
} from "@/features/checkout/schemas/checkout-summary";
import { nonNegativeWorkspaceMoneySchema } from "@/features/checkout/workspace-money";
import { locales } from "@/features/i18n";
import {
  getReservationIntervalValidationIssue,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import { getReservationProductRuleIssue } from "@/features/reservation/schemas/reservation-product-rules";
import { workspaceProductMonitorOptionEffectSchema } from "@/features/reservation/schemas/stored-reservation-details";

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

export const legalDocumentHashSchema = z.object({
  path: z.string().min(1),
  hash: z.string().min(1),
  hashAlgorithm: z.literal("sha256"),
});

export type LegalDocumentHash = z.output<typeof legalDocumentHashSchema>;

export const legalEvidenceSchema = z
  .object({
    documentKey: z.enum(legalDocumentKeys),
    documentHash: z.string().min(1),
    accepted: z.boolean(),
    acceptedAt: z.iso.datetime({ offset: true }),
    locale: z.enum(locales),
    source: z.string().min(1),
    document: legalDocumentHashSchema,
    acknowledgements: z.record(z.string().min(1), z.boolean()).optional(),
  })
  .superRefine((evidence, ctx) => {
    if (evidence.document.hash !== evidence.documentHash) {
      ctx.addIssue({
        code: "custom",
        path: ["documentHash"],
        message: "Legal evidence documentHash must match document.hash.",
      });
    }
  });

export type LegalEvidence = z.output<typeof legalEvidenceSchema>;

export const legalEvidenceMapSchema = z
  .record(z.string().min(1), legalEvidenceSchema)
  .superRefine((evidenceMap, ctx) => {
    for (const [documentHash, evidence] of Object.entries(evidenceMap)) {
      if (documentHash !== evidence.documentHash) {
        ctx.addIssue({
          code: "custom",
          path: [documentHash, "documentHash"],
          message: "Legal evidence map key must match evidence.documentHash.",
        });
      }
    }
  });

export type LegalEvidenceMap = z.output<typeof legalEvidenceMapSchema>;

export class CheckoutDetailsError extends Data.TaggedError(
  "CheckoutDetailsError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const CheckoutDetailsReservationBaseSchema = EffectSchema.Struct({
  startsAt: EffectSchema.NonEmptyString,
  endsAt: EffectSchema.NonEmptyString,
});

const CheckoutDetailsReservationSchema = EffectSchema.Union([
  EffectSchema.Struct({
    ...CheckoutDetailsReservationBaseSchema.fields,
    _tag: EffectSchema.Literal("cowork"),
    tier: EffectSchema.Literal("basic"),
    coffee: EffectSchema.Boolean,
  }),
  EffectSchema.Struct({
    ...CheckoutDetailsReservationBaseSchema.fields,
    _tag: EffectSchema.Literal("cowork"),
    tier: EffectSchema.Literal("plus"),
    coffee: EffectSchema.Literal(true),
  }),
  EffectSchema.Struct({
    ...CheckoutDetailsReservationBaseSchema.fields,
    _tag: EffectSchema.Literal("cowork"),
    tier: EffectSchema.Literal("profi"),
    coffee: EffectSchema.Literal(true),
    monitorOption: workspaceProductMonitorOptionEffectSchema,
  }),
  EffectSchema.Struct({
    ...CheckoutDetailsReservationBaseSchema.fields,
    _tag: EffectSchema.Literal("meeting-room"),
  }),
]);

type CheckoutDetailsReservationDraft =
  typeof CheckoutDetailsReservationSchema.Type;
type CheckoutDetailsReservation = CheckoutDetailsReservationDraft;

const decodeCheckoutDetailsReservation = EffectSchema.decodeUnknownOption(
  CheckoutDetailsReservationSchema
);

const checkoutDetailsReservationInputSchema =
  z.custom<CheckoutDetailsReservationDraft>((value) =>
    Option.isSome(decodeCheckoutDetailsReservation(value))
  );

const validateCheckoutDetailsReservation = (
  reservation: CheckoutDetailsReservationDraft,
  context: z.core.$RefinementCtx<CheckoutDetailsReservationDraft>
) => {
  const intervalIssue = getReservationIntervalValidationIssue(reservation);
  if (intervalIssue) {
    context.addIssue({
      code: "custom",
      path: [intervalIssue.path],
      message: intervalIssue.message,
    });
    return;
  }

  const productRuleIssue = getReservationProductRuleIssue(reservation);
  if (productRuleIssue) {
    context.addIssue({
      code: "custom",
      path: [
        productRuleIssue.path === "entryTier" ? "tier" : productRuleIssue.path,
      ],
      message: productRuleIssue.message,
    });
  }
};

const checkoutDetailsReservationSchema = checkoutDetailsReservationInputSchema
  .superRefine((reservation, context) => {
    validateCheckoutDetailsReservation(reservation, context);
  })
  .transform(
    (reservation): CheckoutDetailsReservation =>
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
      )
  );

// This JSON is intentionally limited to booking, payment, legal, and fulfillment
// state. Customer name, email, and phone remain owned by Dotypos and must not be
// added here or as local database columns.
export const checkoutDetailsJsonSchema = z.object({
  schema: z.literal("workspace-checkout-details"),
  schemaVersion: z.literal(1),
  locale: z.enum(locales),
  reservation: checkoutDetailsReservationSchema,
  payment: z.object({
    expectedPrice: nonNegativeWorkspaceMoneySchema,
    undiscountedPrice: nonNegativeWorkspaceMoneySchema.optional(),
    summary: z.object({
      sections: z.array(
        z.custom<CheckoutSummarySection>(isCheckoutSummarySection)
      ),
      total: nonNegativeWorkspaceMoneySchema,
    }),
    providerRedirectUrl: z.url().optional(),
    customerDiscount: z
      .object({
        source: z.literal("dotypos-discount-group"),
        discountGroupId: z.string().min(1),
        percent: z.number().positive().max(100),
        amount: nonNegativeWorkspaceMoneySchema,
      })
      .optional(),
  }),
  legal: legalEvidenceMapSchema,
  fulfillment: z.object({
    accessCodePolicy: z.literal("workspace-static-v1"),
  }),
});

export type CheckoutDetailsJson = z.output<typeof checkoutDetailsJsonSchema>;
