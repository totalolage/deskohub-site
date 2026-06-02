import { describe, expect, test } from "bun:test";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import {
  checkoutDetailsJsonSchema,
  legalEvidenceMapSchema,
  mergeLegalEvidenceMaps,
  paymentSubmitLegalEvidenceSource,
  reservationSubmitLegalEvidenceSource,
} from "@/features/checkout/schemas/checkout-details";

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

describe("checkout details persistence", () => {
  test("persists quote summary, fingerprint, legal evidence, and no contact PII", () => {
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
        quoteFingerprint: quote.fingerprint,
        summary: quote.summary,
      },
        legal: legalEvidenceMap,
        fulfillment: { accessCodePolicy: "workspace-static-v1" },
      });

    const serialized = JSON.stringify(details);

    expect(details.payment.quoteFingerprint).toBe(quote.fingerprint);
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
      {
        customerDiscount: {
          source: "dotypos-discount-group",
          field: "_discountGroupId",
          discountGroupId: "vip",
          percent: 10,
        },
      }
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
          quoteFingerprint: quote.fingerprint,
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
          quoteFingerprint: quote.fingerprint,
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

  test("merges by document hash and replaces only the same document hash", () => {
    const nextDocument = { ...document, hash: "newHash" };
    const merged = mergeLegalEvidenceMaps({
      existing: legalEvidenceMap,
      incoming: {
        [document.hash]: legalEvidence({ source: "retry_submit" }),
        [nextDocument.hash]: {
          ...legalEvidence({ documentHash: nextDocument.hash }),
          document: nextDocument,
        },
      },
    });

    expect(merged[document.hash]?.source).toBe("retry_submit");
    expect(merged[nextDocument.hash]?.documentHash).toBe(nextDocument.hash);
  });

  test("merge rejects incoming key/hash collisions", () => {
    expect(() =>
      mergeLegalEvidenceMaps({
        existing: legalEvidenceMap,
        incoming: {
          wrongHash: legalEvidence(),
        },
      })
    ).toThrow();
  });
});
