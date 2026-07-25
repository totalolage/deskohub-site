import { describe, expect, test } from "bun:test";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import {
  makeDiscountCommitment,
  materializeDiscountCommitment,
} from "./commitment";

describe("DiscountCommitment", () => {
  test("retains only the canonical product identity in its private payload", () => {
    const productWithImplementationDetail = {
      kind: "cowork" as const,
      tier: "basic" as const,
      implementationDetail: "not part of product identity",
    };
    const product: WorkspaceProductIdentity = productWithImplementationDetail;

    const commitment = makeDiscountCommitment({
      product,
      applications: [],
    });

    expect(materializeDiscountCommitment(commitment, [])).toEqual({
      status: "ready",
      product: { kind: "cowork", tier: "basic" },
      displayedDiscountIds: [],
      applications: [],
    });
    expect(Reflect.ownKeys(commitment)).toEqual([]);
  });

  test("refuses to materialize when a displayed identity differs", () => {
    const application = {
      discount: {
        id: "displayed-id" as never,
        label: "Displayed label",
        adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      },
      subtotalBefore: { value: 1000, exponent: 2, currency: "CZK" },
      amount: { value: 100, exponent: 2, currency: "CZK" },
      subtotalAfter: { value: 900, exponent: 2, currency: "CZK" },
    };
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      applications: [
        {
          application,
          candidate: {
            discount: application.discount,
            provenance: {
              providerNamespace: "test",
              providerReference: "reference",
            },
          },
        },
      ],
    });

    expect(
      materializeDiscountCommitment(commitment, [
        {
          ...application,
          discount: { ...application.discount, label: "Changed label" },
        },
      ])
    ).toEqual({ status: "pricing_changed" });
  });
});
