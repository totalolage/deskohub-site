import { describe, expect, test } from "bun:test";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import {
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
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
      reservationDate: "2026-07-15",
      applications: [],
    });

    expect(getDiscountCommitmentPayload(commitment)).toEqual({
      product: { kind: "cowork", tier: "basic" },
      reservationDate: "2026-07-15",
      applications: [],
    });
    expect(Reflect.ownKeys(commitment)).toEqual([]);
  });

  test("carries the affirmed reservation service date in its private payload", () => {
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      reservationDate: "2026-07-15",
      applications: [],
    });

    expect(getDiscountCommitmentPayload(commitment).reservationDate).toBe(
      "2026-07-15"
    );
  });
});
