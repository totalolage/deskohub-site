import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  checkNexiWebhookSecurityToken,
  decodeNexiWebhookNotification,
  deriveNexiWebhookEventIdentity,
  NexiAmountSchema,
  normalizeNexiWebhookNotification,
} from "./types";

describe("Nexi webhook types", () => {
  test("normalizes webhook payloads and derives identity", async () => {
    const notification = await Effect.runPromise(
      decodeNexiWebhookNotification({
        eventId: " event-id ",
        eventTime: " 2026-06-20T10:00:00Z ",
        securityToken: " security-token ",
        operation: {
          orderId: "order-id",
          operationId: " operation-id ",
          operationType: " CAPTURE ",
          operationResult: " EXECUTED ",
          operationTime: " 2026-06-20T10:01:00Z ",
          operationAmount: " 5000 ",
          operationCurrency: " CZK ",
        },
      })
    );

    expect(notification).toEqual({
      eventId: "event-id",
      eventTime: "2026-06-20T10:00:00Z",
      securityToken: "security-token",
      operation: {
        orderId: "order-id",
        operationId: "operation-id",
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
        operationTime: "2026-06-20T10:01:00Z",
        operationAmount: "5000",
        operationCurrency: "CZK",
      },
    });
    expect(deriveNexiWebhookEventIdentity(notification)).toEqual({
      eventId: "event-id",
      source: "provider",
    });

    expect(
      deriveNexiWebhookEventIdentity({
        operation: notification.operation,
      }).eventId
    ).toBe(
      "nexi:order-id:operation-id:CAPTURE:EXECUTED:2026-06-20T10:01:00Z:5000:CZK"
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
        eventId: " ",
        securityToken: " ",
        operation: { orderId: "order-id", operationId: " " },
      })
    ).toEqual({
      eventId: undefined,
      eventTime: undefined,
      securityToken: undefined,
      operation: {
        orderId: "order-id",
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
