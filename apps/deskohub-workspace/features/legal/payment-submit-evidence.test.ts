import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { legalEvidenceMapSchema } from "@/features/checkout/legal-evidence";
import { getLegalDocumentVersion } from "./document-version";
import {
  getPaymentSubmitLegalDocuments,
  getPaymentSubmitLegalEvidence,
  isCurrentPaymentSubmitLegalAcceptance,
} from "./payment-submit-evidence";

const termsHash =
  "d56d9e83196b802aee01393512cff46d0fef6e01449c72b229db535b0bf095c6";
const operatingRulesHash =
  "05cefdd98d32159cfce228b230931f9cc257643d90f83f327589732476c8ba56";
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

describe("getPaymentSubmitLegalDocuments", () => {
  test("lists the documents a payment submission accepts, as its evidence records them", () => {
    const documents = getPaymentSubmitLegalDocuments("en-US");
    const evidence = getPaymentSubmitLegalEvidence({
      locale: "en-US",
      acceptedAt,
      earlyPerformanceConsent: false,
    });

    expect(documents).toEqual([
      {
        key: "terms-and-conditions",
        path: "/en-US/terms-and-conditions",
        hash: termsHash,
        hashAlgorithm: "sha256",
      },
      {
        key: "operating-rules",
        path: "/en-US/operating-rules",
        hash: operatingRulesHash,
        hashAlgorithm: "sha256",
      },
    ]);
    expect(documents.map(({ key: _key, ...document }) => document)).toEqual(
      Object.values(evidence).map(({ document }) => document)
    );
  });

  test("lists each locale's own published documents", () => {
    expect(getPaymentSubmitLegalDocuments("cs-CZ")).toEqual([
      expect.objectContaining({
        key: "terms-and-conditions",
        path: "/cs-CZ/terms-and-conditions",
        hash: getLegalDocumentVersion("cs-CZ", "terms-and-conditions"),
      }),
      expect.objectContaining({
        key: "operating-rules",
        path: "/cs-CZ/operating-rules",
        hash: getLegalDocumentVersion("cs-CZ", "operating-rules"),
      }),
    ]);
  });
});

describe("isCurrentPaymentSubmitLegalAcceptance", () => {
  const current = [
    { key: "terms-and-conditions", hash: termsHash },
    { key: "operating-rules", hash: operatingRulesHash },
  ];

  test.each([
    ["the current documents", current],
    ["the current documents in another order", [...current].reverse()],
  ])("accepts %s", (_case, accepted) => {
    expect(isCurrentPaymentSubmitLegalAcceptance("en-US", accepted)).toBe(true);
  });

  test.each([
    ["nothing", []],
    ["only the terms", current.slice(0, 1)],
    [
      "a superseded terms version",
      [{ key: "terms-and-conditions", hash: "0".repeat(64) }, current[1]],
    ],
    [
      "one document twice",
      [current[0], { key: "terms-and-conditions", hash: termsHash }],
    ],
    [
      "an extra document",
      [...current, { key: "privacy-policy", hash: termsHash }],
    ],
    [
      "another document in place of the operating rules",
      [current[0], { key: "privacy-policy", hash: operatingRulesHash }],
    ],
    [
      "the hashes swapped between the documents",
      [
        { key: "terms-and-conditions", hash: operatingRulesHash },
        { key: "operating-rules", hash: termsHash },
      ],
    ],
  ])("refuses %s", (_case, accepted) => {
    expect(isCurrentPaymentSubmitLegalAcceptance("en-US", accepted)).toBe(
      false
    );
  });

  test("checks the documents of the submitted locale", () => {
    expect(isCurrentPaymentSubmitLegalAcceptance("cs-CZ", current)).toBe(false);
    expect(
      isCurrentPaymentSubmitLegalAcceptance(
        "cs-CZ",
        getPaymentSubmitLegalDocuments("cs-CZ")
      )
    ).toBe(true);
  });
});
