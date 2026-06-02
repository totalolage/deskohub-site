import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const evidence = (accepted: boolean) => ({
  documentKey: "privacyPolicy",
  documentHash: "privacy-hash",
  accepted,
  acceptedAt: "2099-06-10T10:00:00.000Z",
  locale: "en-US",
  source: "reservation_submit",
  document: {
    path: "/en-US/privacy-policy",
    hash: "privacy-hash",
    hashAlgorithm: "sha256",
  },
});

describe("legal evidence audit input", () => {
  test("preserves rejected accepted false evidence for audit storage", async () => {
    const { parseRejectedLegalEvidenceAuditInput } = await import(
      "@/features/checkout/backend/legal-evidence-audit.repository"
    );

    const parsed = parseRejectedLegalEvidenceAuditInput({
      orderId: null,
      idempotencyKey: "reservation-key",
      evidence: evidence(false),
    });

    expect(parsed).toEqual({
      orderId: null,
      idempotencyKey: "reservation-key",
      documentHash: "privacy-hash",
      accepted: false,
      acceptedAt: new Date("2099-06-10T10:00:00.000Z"),
      source: "reservation_submit",
    });
  });

  test("rejects accepted true evidence from rejected audit path", async () => {
    const { parseRejectedLegalEvidenceAuditInput } = await import(
      "@/features/checkout/backend/legal-evidence-audit.repository"
    );

    expect(() =>
      parseRejectedLegalEvidenceAuditInput({
        idempotencyKey: "reservation-key",
        evidence: evidence(true),
      })
    ).toThrow();
  });

  test("rejects missing source before audit construction", async () => {
    const { parseRejectedLegalEvidenceAuditInput } = await import(
      "@/features/checkout/backend/legal-evidence-audit.repository"
    );

    expect(() =>
      parseRejectedLegalEvidenceAuditInput({
        idempotencyKey: "reservation-key",
        evidence: { ...evidence(false), source: "" },
      })
    ).toThrow();
  });
});
