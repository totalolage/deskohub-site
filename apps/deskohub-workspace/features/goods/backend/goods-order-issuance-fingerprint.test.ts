import { describe, expect, test } from "bun:test";
import { getGoodsOrderIssuanceFingerprint } from "./goods-order-issuance-fingerprint";

const input = {
  acknowledged: true as const,
  quoteToken: "sealed-quote-token",
};

describe("goods order issuance fingerprint", () => {
  test("binds replay to the exact opaque quote token and acknowledgement", () => {
    const fingerprint = getGoodsOrderIssuanceFingerprint(input);

    expect(
      getGoodsOrderIssuanceFingerprint({
        ...input,
        quoteToken: "different-sealed-quote-token",
      })
    ).not.toBe(fingerprint);
  });

  test("does not persist the opaque token itself", () => {
    expect(getGoodsOrderIssuanceFingerprint(input)).toMatch(/^[0-9a-f]{64}$/);
    expect(getGoodsOrderIssuanceFingerprint(input)).not.toContain(
      input.quoteToken
    );
  });
});
