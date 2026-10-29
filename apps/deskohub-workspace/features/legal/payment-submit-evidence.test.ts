import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { legalEvidenceMapSchema } from "@/features/checkout/legal-evidence";
import { getPaymentSubmitLegalEvidence } from "./payment-submit-evidence";

const termsHash =
  "94c5ab326bd014146ce95e7408885c33fe563821877ad507f8dd512ef4388b1a";
const operatingRulesHash =
  "e1d0be9cf7391fbcbd96a11b5bc8a4ef527abec495e323a16f67e10b3b6a64af";
const acceptedAt = "2026-10-29T10:00:00Z";

// The records checkout built by hand before the builder took them over.
const getCheckoutBuiltEvidence = (earlyPerformanceConsent: boolean) =>
  Schema.decodeUnknownSync(legalEvidenceMapSchema, {
    onExcessProperty: "error",
  })({
    [termsHash]: {
      documentKey: "termsAndConditions",
      documentHash: termsHash,
      accepted: true,
      acceptedAt,
      locale: "en-US",
      source: "payment_submit",
      document: {
        path: "/en-US/terms-and-conditions",
        hash: termsHash,
        hashAlgorithm: "sha256",
      },
      acknowledgements: earlyPerformanceConsent
        ? { earlyPerformanceConsent: true }
        : undefined,
    },
    [operatingRulesHash]: {
      documentKey: "operatingRules",
      documentHash: operatingRulesHash,
      accepted: true,
      acceptedAt,
      locale: "en-US",
      source: "payment_submit",
      document: {
        path: "/en-US/operating-rules",
        hash: operatingRulesHash,
        hashAlgorithm: "sha256",
      },
    },
  });

describe("getPaymentSubmitLegalEvidence", () => {
  test.each([true, false])(
    "records the accepted terms and operating rules with early-performance consent %p",
    (earlyPerformanceConsent) => {
      const evidence = getPaymentSubmitLegalEvidence({
        locale: "en-US",
        acceptedAt,
        earlyPerformanceConsent,
      });

      const checkoutBuiltEvidence = getCheckoutBuiltEvidence(
        earlyPerformanceConsent
      );
      expect(evidence).toStrictEqual(checkoutBuiltEvidence);
      expect(JSON.stringify(evidence)).toBe(
        JSON.stringify(checkoutBuiltEvidence)
      );
      expect(Object.keys(evidence)).toEqual([termsHash, operatingRulesHash]);
      expect(
        Object.values(evidence).map(({ documentKey }) => documentKey)
      ).toEqual(["termsAndConditions", "operatingRules"]);
    }
  );

  test("carries early-performance consent on the terms record only", () => {
    const evidence = getPaymentSubmitLegalEvidence({
      locale: "cs-CZ",
      acceptedAt,
      earlyPerformanceConsent: true,
    });

    expect(
      Object.values(evidence).map(({ documentKey, acknowledgements }) => [
        documentKey,
        acknowledgements,
      ])
    ).toEqual([
      ["termsAndConditions", { earlyPerformanceConsent: true }],
      ["operatingRules", undefined],
    ]);
  });
});
