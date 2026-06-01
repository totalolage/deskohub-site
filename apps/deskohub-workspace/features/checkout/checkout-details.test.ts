import { describe, expect, test } from "bun:test";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import { checkoutDetailsJsonSchema } from "@/features/checkout/schemas/checkout-details";

const document = {
  path: "/en-US/terms-and-conditions",
  hash: "abc123",
  hashAlgorithm: "sha256",
} as const;

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
      legal: {
        acceptedAt: "2099-06-10T10:00:00.000Z",
        locale: "en-US",
        source: "workspace-pay-final-submit",
        documents: {
          termsAndConditions: document,
          operatingRules: { ...document, path: "/en-US/operating-rules" },
          privacyPolicy: { ...document, path: "/en-US/privacy-policy" },
        },
        acknowledgements: {
          termsAndConditions: true,
          operatingRules: true,
          noRefundAfterPinDelivery: true,
          privacyPolicy: true,
        },
      },
      fulfillment: { accessCodePolicy: "workspace-static-v1" },
    });

    const serialized = JSON.stringify(details);

    expect(details.payment.quoteFingerprint).toBe(quote.fingerprint);
    expect(details.payment.summary.total).toEqual(quote.summary.total);
    expect(details.legal.source).toBe("workspace-pay-final-submit");
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
        legal: {
          acceptedAt: "2099-06-10T10:00:00.000Z",
          locale: "en-US",
          source: "workspace-pay-final-submit",
          documents: {
            termsAndConditions: document,
            operatingRules: { ...document, path: "/en-US/operating-rules" },
            privacyPolicy: { ...document, path: "/en-US/privacy-policy" },
          },
          acknowledgements: {
            termsAndConditions: true,
            operatingRules: true,
            noRefundAfterPinDelivery: true,
            privacyPolicy: true,
          },
        },
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
        legal: {
          acceptedAt: "2099-06-10T10:00:00.000Z",
          locale: "en-US",
          source: "workspace-pay-final-submit",
          documents: {
            termsAndConditions: document,
            operatingRules: { ...document, path: "/en-US/operating-rules" },
            privacyPolicy: { ...document, path: "/en-US/privacy-policy" },
          },
          acknowledgements: {
            termsAndConditions: true,
            operatingRules: true,
            noRefundAfterPinDelivery: true,
            privacyPolicy: true,
          },
        },
        fulfillment: { accessCodePolicy: "workspace-static-v1" },
      })
    ).toThrow();
  });
});
