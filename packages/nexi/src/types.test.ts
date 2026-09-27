import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  checkNexiWebhookSecurityToken,
  decodeNexiWebhookNotification,
  deriveNexiWebhookEventIdentity,
  getNexiMaskedInstrumentSuffix,
  NexiAmountSchema,
  NexiContractIdSchema,
  NexiOperationIdSchema,
  NexiOrderIdSchema,
  NexiWebhookEventIdSchema,
  normalizeNexiPaymentCircuit,
  normalizeNexiWebhookNotification,
  toNexiCardContract,
} from "./types";

const nexiOrderId = Schema.decodeUnknownSync(NexiOrderIdSchema);
const nexiOperationId = Schema.decodeUnknownSync(NexiOperationIdSchema);
const nexiWebhookEventId = Schema.decodeUnknownSync(NexiWebhookEventIdSchema);
const nexiContractId = Schema.decodeUnknownSync(NexiContractIdSchema);

describe("Nexi webhook types", () => {
  test("normalizes webhook payloads and derives identity", async () => {
    const notification = await Effect.runPromise(
      decodeNexiWebhookNotification({
        eventId: nexiWebhookEventId(" event-id "),
        eventTime: " 2026-06-20T10:00:00Z ",
        securityToken: " security-token ",
        operation: {
          orderId: nexiOrderId("order-id"),
          operationId: nexiOperationId(" operation-id "),
          operationType: " CAPTURE ",
          operationResult: " EXECUTED ",
          operationTime: " 2026-06-20T10:01:00Z ",
          operationAmount: " 5000 ",
          operationCurrency: " CZK ",
        },
      })
    );

    expect(notification).toEqual({
      eventId: nexiWebhookEventId("event-id"),
      eventTime: "2026-06-20T10:00:00Z",
      securityToken: "security-token",
      operation: {
        orderId: nexiOrderId("order-id"),
        operationId: nexiOperationId("operation-id"),
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
        operationTime: "2026-06-20T10:01:00Z",
        operationAmount: "5000",
        operationCurrency: "CZK",
      },
    });
    expect(deriveNexiWebhookEventIdentity(notification)).toEqual({
      eventId: nexiWebhookEventId("event-id"),
      source: "provider",
    });

    expect(
      deriveNexiWebhookEventIdentity({
        operation: notification.operation,
      }).eventId
    ).toBe(
      nexiWebhookEventId(
        "nexi:order-id:operation-id:CAPTURE:EXECUTED:2026-06-20T10:01:00Z:5000:CZK"
      )
    );
  });

  test("reports security token match, mismatch, and absence", () => {
    expect(
      checkNexiWebhookSecurityToken({
        notificationSecurityToken: "token",
        expectedSecurityToken: "token",
      })
    ).toEqual({ status: "match" });
    expect(
      checkNexiWebhookSecurityToken({
        notificationSecurityToken: "token",
        expectedSecurityToken: "other",
      })
    ).toEqual({ status: "mismatch" });
    expect(
      checkNexiWebhookSecurityToken({
        notificationSecurityToken: " ",
        expectedSecurityToken: "token",
      })
    ).toEqual({ status: "absent" });
  });

  test("rejects zero amount and unsupported currency", () => {
    expect(
      Schema.is(NexiAmountSchema)({ amount: "1", currency: "CZK" })
    ).toBeTrue();
    expect(
      Schema.is(NexiAmountSchema)({ amount: "0", currency: "CZK" })
    ).toBeFalse();
    expect(
      Schema.is(NexiAmountSchema)({ amount: "1", currency: "USD" })
    ).toBeFalse();
  });

  test("normalizes empty optional strings away", () => {
    expect(
      normalizeNexiWebhookNotification({
        eventId: nexiWebhookEventId(" "),
        securityToken: " ",
        operation: {
          orderId: nexiOrderId("order-id"),
          operationId: nexiOperationId(" "),
        },
      })
    ).toEqual({
      eventId: undefined,
      eventTime: undefined,
      securityToken: undefined,
      operation: {
        orderId: nexiOrderId("order-id"),
        operationId: undefined,
        operationType: undefined,
        operationResult: undefined,
        operationTime: undefined,
        operationAmount: undefined,
        operationCurrency: undefined,
      },
    });
  });
});

describe("Nexi card contract types", () => {
  test("bounds contract identifiers and derives safe list fields", () => {
    const nexiContractId = Schema.decodeUnknownSync(NexiContractIdSchema);
    expect(String(nexiContractId("contract-1"))).toBe("contract-1");
    expect(() => nexiContractId("")).toThrow();
    expect(() => nexiContractId("x".repeat(19))).toThrow();
    expect(String(nexiContractId("x".repeat(18)))).toBe("x".repeat(18));

    expect(getNexiMaskedInstrumentSuffix("***6152")).toBe("6152");
    expect(getNexiMaskedInstrumentSuffix(" *** 42 ")).toBe("42");
    expect(getNexiMaskedInstrumentSuffix("12345")).toBeUndefined();
    expect(getNexiMaskedInstrumentSuffix("card ending 1234")).toBeUndefined();

    expect(normalizeNexiPaymentCircuit("visa")).toBe("VISA");
    expect(normalizeNexiPaymentCircuit("MasterCard")).toBe("MC");
    expect(normalizeNexiPaymentCircuit("SOME_OTHER_CIRCUIT")).toBeUndefined();
  });
});

describe("toNexiCardContract", () => {
  const base = {
    contractId: "contract-1",
    paymentCircuit: "VISA",
    paymentInstrumentInfo: "***6152",
  };

  test("preserves the provider contract type", () => {
    expect(toNexiCardContract({ ...base, contractType: "CIT" })).toEqual({
      contractId: nexiContractId("contract-1"),
      contractType: "CIT",
      circuit: "VISA",
      maskedInstrumentSuffix: "6152",
    });
    expect(
      toNexiCardContract({ ...base, contractType: "MIT_UNSCHEDULED" })
        ?.contractType
    ).toBe("MIT_UNSCHEDULED");
    expect(
      toNexiCardContract({ ...base, contractType: "MIT_SCHEDULED" })
        ?.contractType
    ).toBe("MIT_SCHEDULED");
  });

  test("skips entries with a missing or invalid contract type", () => {
    expect(
      toNexiCardContract({
        ...base,
        contractType: "NOT_A_TYPE" as never,
      })
    ).toBeUndefined();
    expect(
      toNexiCardContract({ ...base, contractType: "" as never })
    ).toBeUndefined();
  });
});
