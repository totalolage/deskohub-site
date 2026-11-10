import { describe, expect, test } from "bun:test";
import type { PaymentVerificationResult } from "@deskohub/nexi";
import { paymentVerificationLogFields } from "./payment-verification-log-fields";

const verification: PaymentVerificationResult = {
  status: "success",
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationCount: 1,
    amount: "35000",
    currency: "CZK",
    orderStatus: "EXECUTED",
    captureExecuted: true,
  },
  mismatches: ["amount", "currency"],
};

describe("paymentVerificationLogFields", () => {
  test("keeps the outcome as scalars, never the provider facts", () => {
    const fields = paymentVerificationLogFields(verification);

    expect(fields).toEqual({
      verificationStatus: "success",
      verificationMismatches: "amount,currency",
      providerOrderStatus: "EXECUTED",
    });
  });

  test("leaves every field empty without a verification", () => {
    expect(Object.values(paymentVerificationLogFields(undefined))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
