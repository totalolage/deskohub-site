import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  isNexiRefundOperation,
  isSuccessfulNexiRefund,
  summarizeNexiRefunds,
} from "./refunds";
import { NexiOperationIdSchema } from "./types";

const operationId = Schema.decodeUnknownSync(NexiOperationIdSchema);

describe("Nexi refunds", () => {
  test("recognizes refund operations whatever their result", () => {
    expect(isNexiRefundOperation({ operationType: "refund" })).toBe(true);
    expect(isNexiRefundOperation({ operationType: "CAPTURE" })).toBe(false);
    expect(
      isSuccessfulNexiRefund({
        operationType: "REFUND",
        operationResult: "PENDING",
      })
    ).toBe(false);
    expect(
      isSuccessfulNexiRefund({
        operationType: "REFUND",
        operationResult: "EXECUTED",
      })
    ).toBe(true);
    expect(
      isSuccessfulNexiRefund({
        operationType: "VOID",
        operationResult: "VOIDED",
      })
    ).toBe(false);
  });

  test("sums successful refunds and keeps the latest refund time", () => {
    expect(
      summarizeNexiRefunds([
        {
          operationId: operationId("capture"),
          operationType: "CAPTURE",
          operationResult: "EXECUTED",
          amount: "1000",
        },
        {
          operationId: operationId("refund-1"),
          operationType: "REFUND",
          operationResult: "REFUNDED",
          operationTime: "2026-10-02T10:00:00+02:00",
          amount: "300",
        },
        {
          operationId: operationId("refund-2"),
          operationType: "REFUND",
          operationResult: "EXECUTED",
          operationTime: "2026-10-03T09:00:00+02:00",
          amount: "200",
        },
        {
          operationId: operationId("refund-3"),
          operationType: "REFUND",
          operationResult: "FAILED",
          operationTime: "2026-10-04T09:00:00+02:00",
          amount: "500",
        },
      ])
    ).toEqual({
      amount: 500,
      lastRefundedAt: "2026-10-03T09:00:00+02:00",
      operationIds: [operationId("refund-1"), operationId("refund-2")],
    });
  });

  test("returns nothing without a successful refund amount", () => {
    expect(
      summarizeNexiRefunds([
        {
          operationType: "REFUND",
          operationResult: "PENDING",
          amount: "1000",
        },
        { operationType: "REFUND", operationResult: "REFUNDED" },
      ])
    ).toBeUndefined();
  });
});
