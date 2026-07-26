import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  checkNexiWebhookSecurityToken,
  decodeNexiWebhookNotification,
  deriveNexiWebhookEventIdentity,
  NexiAmountSchema,
  normalizeNexiProviderOperationId,
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
    ).toMatch(/^nexi:[a-f0-9]{64}$/);
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

  test("bounds provider operation identities and scopes malformed event identities to an order", () => {
    const oversizedOperationId = "operation".repeat(40);
    const normalized = normalizeNexiProviderOperationId(oversizedOperationId);

    expect(normalized).toMatch(/^nexi-operation:[a-f0-9]{64}$/);
    expect(normalized?.length).toBeLessThanOrEqual(128);
    expect(normalized).not.toContain(oversizedOperationId);

    const first = deriveNexiWebhookEventIdentity({
      eventId: "invalid event identity",
      operation: {
        orderId: "first-order",
        operationId: oversizedOperationId,
      },
    });
    const second = deriveNexiWebhookEventIdentity({
      eventId: "invalid event identity",
      operation: {
        orderId: "second-order",
        operationId: oversizedOperationId,
      },
    });

    expect(first.eventId).toMatch(/^nexi:[a-f0-9]{64}$/);
    expect(second.eventId).toMatch(/^nexi:[a-f0-9]{64}$/);
    expect(first.eventId).not.toBe(second.eventId);
  });
});
