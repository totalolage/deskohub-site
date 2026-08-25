import { describe, expect, test } from "bun:test";
import { getGoodsOrderIssuanceFingerprint } from "./goods-order-issuance-fingerprint";

const input = {
  expectedCart: {
    revision: 3,
    items: [{ productId: "product-1", quantity: 2 }],
  },
  legalDocuments: [
    {
      documentKey: "termsAndConditions" as const,
      document: {
        path: "/en-US/terms-and-conditions",
        hash: "terms-hash",
        hashAlgorithm: "sha256" as const,
      },
      acknowledgements: { withdrawal: true, marketing: false },
    },
  ],
};

describe("goods order issuance fingerprint", () => {
  test("covers cart revisions, items, document hashes, and acknowledgements", () => {
    const fingerprint = getGoodsOrderIssuanceFingerprint(input);

    expect(
      getGoodsOrderIssuanceFingerprint({
        ...input,
        expectedCart: { ...input.expectedCart, revision: 4 },
      })
    ).not.toBe(fingerprint);
    expect(
      getGoodsOrderIssuanceFingerprint({
        ...input,
        expectedCart: {
          ...input.expectedCart,
          items: [{ productId: "product-1", quantity: 3 }],
        },
      })
    ).not.toBe(fingerprint);
    expect(
      getGoodsOrderIssuanceFingerprint({
        ...input,
        legalDocuments: [
          {
            ...input.legalDocuments[0],
            document: { ...input.legalDocuments[0].document, hash: "changed" },
          },
        ],
      })
    ).not.toBe(fingerprint);
    expect(
      getGoodsOrderIssuanceFingerprint({
        ...input,
        legalDocuments: [
          {
            ...input.legalDocuments[0],
            acknowledgements: { withdrawal: false, marketing: false },
          },
        ],
      })
    ).not.toBe(fingerprint);
  });

  test("is stable across irrelevant object insertion order", () => {
    expect(
      getGoodsOrderIssuanceFingerprint({
        ...input,
        legalDocuments: [
          {
            ...input.legalDocuments[0],
            acknowledgements: { marketing: false, withdrawal: true },
          },
        ],
      })
    ).toBe(getGoodsOrderIssuanceFingerprint(input));
  });
});
