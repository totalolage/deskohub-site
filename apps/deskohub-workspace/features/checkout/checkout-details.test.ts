import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import {
  checkoutDetailsJsonSchema,
  legalEvidenceMapSchema,
  paymentSubmitLegalEvidenceSource,
  reservationSubmitLegalEvidenceSource,
} from "@/features/checkout/schemas/checkout-details";
import {
  type DiscountQuote,
  discountIdSchema,
} from "@/features/discounts/contracts";

const document = {
  path: "/en-US/terms-and-conditions",
  hash: "abc123",
  hashAlgorithm: "sha256",
} as const;

const legalEvidence = ({
  accepted = true,
  documentHash = document.hash,
  source = paymentSubmitLegalEvidenceSource,
}: {
  readonly accepted?: boolean;
  readonly documentHash?: string;
  readonly source?: string;
} = {}) => ({
  documentKey: "termsAndConditions",
  documentHash,
  accepted,
  acceptedAt: "2099-06-10T10:00:00.000Z",
  locale: "en-US",
  source,
  document: { ...document, hash: documentHash },
});

const legalEvidenceMap = legalEvidenceMapSchema.parse({
  [document.hash]: legalEvidence(),
});

const money = (value: number) => ({ value, exponent: 2, currency: "CZK" });
const discountId = Schema.decodeUnknownSync(discountIdSchema);
const genericDiscountQuote: DiscountQuote = {
  product: { kind: "cowork", tier: "basic" },
  discountableSubtotal: money(35_000),
  discounts: [
    {
      discount: {
        id: discountId("discount-1"),
        label: "Database sale",
        adjustment: { kind: "percentage", basisPoints: 1000 },
      },
      subtotalBefore: money(35_000),
      amount: money(3500),
      subtotalAfter: money(31_500),
    },
  ],
  totalDiscount: money(3500),
  discountedSubtotal: money(31_500),
};

describe("checkout details persistence", () => {
  test("persists quote summary, legal evidence, and no contact PII", () => {
    const quote = buildWorkspaceCheckoutQuote({
      entryTier: "basic",
      coffee: false,
    });
    const details = checkoutDetailsJsonSchema.parse({
      schema: "workspace-checkout-details",
      schemaVersion: 1,
      locale: "en-US",
      reservation: {
        tier: "basic",
        date: "2099-06-10",
        coffee: false,
        message: "Please keep this private.",
      },
      payment: {
        expectedPrice: quote.payment.expectedPrice,
        undiscountedPrice: quote.payment.undiscountedPrice,
        discounts: quote.payment.discounts,
        summary: quote.summary,
      },
      legal: legalEvidenceMap,
      fulfillment: { accessCodePolicy: "workspace-static-v1" },
    });

    const serialized = JSON.stringify(details);

    expect(details.payment.summary.total).toEqual(quote.summary.total);
    expect(details.legal[document.hash]?.source).toBe(
      paymentSubmitLegalEvidenceSource
    );
    expect(serialized).not.toContain("Ada Lovelace");
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("+420777123456");
    expect(serialized).not.toContain("Please keep this private.");
  });

  test("accepts negative discount rows but rejects negative expected totals", () => {
    const quote = buildWorkspaceCheckoutQuote(
      { entryTier: "basic", coffee: false },
      { discountQuote: genericDiscountQuote }
    );

    expect(() =>
      checkoutDetailsJsonSchema.parse({
        schema: "workspace-checkout-details",
        schemaVersion: 1,
        locale: "en-US",
        reservation: {
          tier: "basic",
          date: "2099-06-10",
          coffee: false,
        },
        payment: {
          expectedPrice: quote.payment.expectedPrice,
          undiscountedPrice: quote.payment.undiscountedPrice,
          discounts: quote.payment.discounts,
          summary: quote.summary,
        },
        legal: legalEvidenceMap,
        fulfillment: { accessCodePolicy: "workspace-static-v1" },
      })
    ).not.toThrow();

    expect(() =>
      checkoutDetailsJsonSchema.parse({
        schema: "workspace-checkout-details",
        schemaVersion: 1,
        locale: "en-US",
        reservation: {
          tier: "basic",
          date: "2099-06-10",
          coffee: false,
        },
        payment: {
          expectedPrice: { value: -1, exponent: 2, currency: "CZK" },
          undiscountedPrice: quote.payment.undiscountedPrice,
          discounts: quote.payment.discounts,
          summary: quote.summary,
        },
        legal: legalEvidenceMap,
        fulfillment: { accessCodePolicy: "workspace-static-v1" },
      })
    ).toThrow();
  });

  test("rejects provider-private fields in generic discount snapshots", () => {
    const quote = buildWorkspaceCheckoutQuote(
      { entryTier: "basic", coffee: false },
      { discountQuote: genericDiscountQuote }
    );

    expect(() =>
      checkoutDetailsJsonSchema.parse({
        schema: "workspace-checkout-details",
        schemaVersion: 1,
        locale: "en-US",
        reservation: {
          tier: "basic",
          date: "2099-06-10",
          coffee: false,
        },
        payment: {
          expectedPrice: quote.payment.expectedPrice,
          undiscountedPrice: quote.payment.undiscountedPrice,
          discounts: [
            {
              ...quote.payment.discounts[0],
              providerReference: "private-provider-reference",
            },
          ],
          summary: quote.summary,
        },
        legal: legalEvidenceMap,
        fulfillment: { accessCodePolicy: "workspace-static-v1" },
      })
    ).toThrow();
  });

  test("accepts partial legal evidence maps and preserves accepted false", () => {
    const parsed = legalEvidenceMapSchema.parse({
      [document.hash]: legalEvidence({
        accepted: false,
        source: reservationSubmitLegalEvidenceSource,
      }),
    });

    expect(Object.keys(parsed)).toEqual([document.hash]);
    expect(parsed[document.hash]?.accepted).toBe(false);
    expect(parsed[document.hash]?.source).toBe(
      reservationSubmitLegalEvidenceSource
    );
  });

  test("rejects legal evidence map key and document hash mismatches", () => {
    expect(() =>
      legalEvidenceMapSchema.parse({
        wrongHash: legalEvidence(),
      })
    ).toThrow();

    expect(() =>
      legalEvidenceMapSchema.parse({
        [document.hash]: {
          ...legalEvidence(),
          document: { ...document, hash: "different" },
        },
      })
    ).toThrow();
  });

  test("keeps source as free storage string while canonical constants construct known sources", () => {
    const parsed = legalEvidenceMapSchema.parse({
      [document.hash]: legalEvidence({ source: "migration_backfill" }),
    });

    expect(paymentSubmitLegalEvidenceSource).toBe("payment_submit");
    expect(reservationSubmitLegalEvidenceSource).toBe("reservation_submit");
    expect(parsed[document.hash]?.source).toBe("migration_backfill");
  });
});
