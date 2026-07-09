import { Data, Schema as EffectSchema, Option } from "effect";
import { z } from "zod/v4";
import {
  getWorkspaceProductByTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { checkoutSummarySectionSchema } from "@/features/checkout/schemas/checkout-summary";
import { nonNegativeWorkspaceMoneySchema } from "@/features/checkout/workspace-money";
import { locales } from "@/features/i18n";
import { getReservationProductMonitorOption } from "@/features/reservation/schemas/reservation";
import {
  getReservationIntervalValidationIssue,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import { getReservationProductRuleIssue } from "@/features/reservation/schemas/reservation-product-rules";

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

type CheckoutDetailsReservationBase =
  typeof CheckoutDetailsReservationBaseSchema.Type;

type CheckoutDetailsReservationDraft =
  | (CheckoutDetailsReservationBase & {
      readonly _tag: "cowork";
      readonly tier: (typeof workspaceCoworkProductTiers)[number];
      readonly coffee: boolean;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    })
  | (CheckoutDetailsReservationBase & {
      readonly _tag: "meeting-room";
    });
type CheckoutDetailsReservation =
  | (CheckoutDetailsReservationBase & {
      readonly _tag: "cowork";
      readonly tier: (typeof workspaceCoworkProductTiers)[number];
      readonly coffee: boolean;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    })
  | (CheckoutDetailsReservationBase & {
      readonly _tag: "meeting-room";
    });

const CheckoutDetailsReservationSchema = EffectSchema.Union([
  EffectSchema.Struct({
    ...CheckoutDetailsReservationBaseSchema.fields,
    _tag: EffectSchema.Literal("cowork"),
    tier: EffectSchema.Literals(workspaceCoworkProductTiers),
    coffee: EffectSchema.Boolean,
    monitorOption: EffectSchema.optional(
      EffectSchema.Literals(workspaceProductMonitorOptions)
    ),
  }),
  EffectSchema.Struct({
    ...CheckoutDetailsReservationBaseSchema.fields,
    _tag: EffectSchema.Literal("meeting-room"),
  }),
]);

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

  const productRuleIssue = getReservationProductRuleIssue(
    reservation._tag === "meeting-room"
      ? {
          ...reservation,
          entryTier: "meeting-room",
        }
      : {
          ...reservation,
          entryTier: reservation.tier,
        }
  );
  if (productRuleIssue) {
    context.addIssue({
      code: "custom",
      path: [
        productRuleIssue.path === "entryTier" ? "tier" : productRuleIssue.path,
      ],
      message: productRuleIssue.message,
    });
    return;
  }

  if (reservation._tag === "meeting-room") return;

  const product = getWorkspaceProductByTier(reservation.tier);
  const monitorOption = getReservationProductMonitorOption({
    ...reservation,
    entryTier: reservation.tier,
  });

  if (product.requiresMonitorOption && !monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: "Monitor option is required for this entry tier.",
    });
    return;
  }

  if (
    product.requiresMonitorOption &&
    monitorOption &&
    !product.allowedMonitorOptions.includes(monitorOption)
  ) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: "Monitor option is unavailable for this entry tier.",
    });
    return;
  }

  if (!product.requiresMonitorOption && monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: "Monitor option is unavailable for this entry tier.",
    });
  }
};

const checkoutDetailsReservationSchema = checkoutDetailsReservationInputSchema
  .superRefine((reservation, context) => {
    validateCheckoutDetailsReservation(reservation, context);
  })
  .transform((reservation): CheckoutDetailsReservation => {
    if (reservation._tag === "meeting-room") {
      const normalized = unsafeNormalizeReservationInterval(reservation);
      return {
        _tag: "meeting-room",
        startsAt: normalized.startsAt,
        endsAt: normalized.endsAt,
      };
    }

    const normalized = unsafeNormalizeReservationInterval(reservation);
    return {
      _tag: "cowork",
      tier: reservation.tier,
      startsAt: normalized.startsAt,
      endsAt: normalized.endsAt,
      coffee: reservation.coffee,
      monitorOption: reservation.monitorOption,
    };
  });

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
      sections: z.array(checkoutSummarySectionSchema),
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
