import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote as buildCoworkPriceQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import {
  legalEvidenceMapSchema,
  paymentSubmitLegalEvidenceSource,
} from "@/features/checkout/legal-evidence";
import { checkoutDetailsSchema } from "@/features/checkout/schemas/checkout-details";
import {
  type DiscountQuote,
  discountIdSchema,
} from "@/features/discounts/contracts";

const buildCoworkReservationQuote = (
  ...args: Parameters<typeof buildCoworkPriceQuote>
) => ({
  ...buildCoworkPriceQuote(...args),
  summary: buildCoworkCheckoutSummary(...args),
});

const document = {
  path: "/en-US/terms-and-conditions",
  hash: "abc123",
  hashAlgorithm: "sha256",
} as const;

const strictParseOptions = { onExcessProperty: "error" } as const;
const decodeCheckoutDetails = Schema.decodeUnknownSync(
  checkoutDetailsSchema,
  strictParseOptions
);
const decodeLegalEvidenceMap = Schema.decodeUnknownSync(
  legalEvidenceMapSchema,
  strictParseOptions
);

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

const legalEvidenceMap = decodeLegalEvidenceMap({
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
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const details = decodeCheckoutDetails({
      locale: "en-US",
      reservation: {
        kind: "cowork",
        entryTier: "basic",
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
    });

    expect(details.payment.summary.total).toEqual(quote.summary.total);
    expect(details.legal[document.hash]?.source).toBe(
      paymentSubmitLegalEvidenceSource
    );
    for (const [field, value] of Object.entries({
      name: "Ada Lovelace",
      email: testEmailAddress("ada"),
      phone: "+420777123456",
      message: "Please keep this private.",
    })) {
      expect(() =>
        decodeCheckoutDetails({
          ...details,
          reservation: { ...details.reservation, [field]: value },
        })
      ).toThrow(`at ["reservation"]["${field}"]`);
    }
  });

  test("rejects provider-private fields in generic discount snapshots", () => {
    const quote = buildCoworkReservationQuote(
      { entryTier: "basic", coffee: false },
      { discountQuote: genericDiscountQuote }
    );

    expect(() =>
      decodeCheckoutDetails({
        locale: "en-US",
        reservation: {
          kind: "cowork",
          entryTier: "basic",
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
      })
    ).toThrow();
  });

  test("rejects legal evidence map key and document hash mismatches", () => {
    expect(() =>
      decodeLegalEvidenceMap({
        wrongHash: legalEvidence(),
      })
    ).toThrow();

    expect(() =>
      decodeLegalEvidenceMap({
        [document.hash]: {
          ...legalEvidence(),
          document: { ...document, hash: "different" },
        },
      })
    ).toThrow();
  });
});
