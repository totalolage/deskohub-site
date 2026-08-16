import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { goodsOrderIssuanceFactsSchema } from "./goods-order";

const decodeFacts = Schema.decodeUnknownSync(goodsOrderIssuanceFactsSchema, {
  errors: "all",
  onExcessProperty: "error",
});

const validFacts = {
  issuanceId: "018f1e36-7a31-7c07-90f4-8f2531cd1212",
  expectedCart: {
    revision: 3,
    items: [{ productId: "product-1", quantity: 2 }],
  },
  lines: [
    {
      product: {
        kind: "goods",
        categoryId: "category-1",
        productId: "product-1",
      },
      description: "Sparkling water",
      quantity: 2,
      unitPrice: { value: 4500, exponent: 2, currency: "CZK" },
      undiscountedTotal: { value: 9000, exponent: 2, currency: "CZK" },
      payableTotal: { value: 8000, exponent: 2, currency: "CZK" },
    },
  ],
  locale: "en-US",
  legalDocuments: [
    {
      documentKey: "termsAndConditions",
      document: {
        path: "/en-US/terms-and-conditions",
        hash: "terms-hash",
        hashAlgorithm: "sha256",
      },
    },
  ],
} as const;

describe("goods order issuance facts", () => {
  test("accepts one exact cart with reconciled immutable lines", () => {
    expect(decodeFacts(validFacts)).toMatchObject(validFacts);
  });

  test("rejects mismatched cart quantities and line money", () => {
    expect(() =>
      decodeFacts({
        ...validFacts,
        expectedCart: {
          ...validFacts.expectedCart,
          items: [{ productId: "product-1", quantity: 3 }],
        },
      })
    ).toThrow();
    expect(() =>
      decodeFacts({
        ...validFacts,
        lines: [
          {
            ...validFacts.lines[0],
            undiscountedTotal: {
              ...validFacts.lines[0].undiscountedTotal,
              value: 8999,
            },
          },
        ],
      })
    ).toThrow();
  });

  test("rejects duplicate legal evidence", () => {
    expect(() =>
      decodeFacts({
        ...validFacts,
        legalDocuments: [
          validFacts.legalDocuments[0],
          validFacts.legalDocuments[0],
        ],
      })
    ).toThrow();
  });
});
