import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  createCustomerEmailInitialIdempotencyKey,
  createCustomerEmailRecoveryIdempotencyKey,
} from "./customer-email-idempotency-key";

describe("createCustomerEmailInitialIdempotencyKey", () => {
  test("keys the first generation by the confirmation category and reservation", () => {
    expect(
      createCustomerEmailInitialIdempotencyKey(
        workspaceReservationIdSchema.make("reservation-id")
      )
    ).toBe("workspace-paid-reservation-access-reservation-id");
  });
});

describe("createCustomerEmailRecoveryIdempotencyKey", () => {
  test("derives distinct stable keys for long prior delivery ids beyond the provider key limit", () => {
    const sharedLongPrefix = "resend-email-id".padEnd(213, "0");
    const firstPriorDeliveryId = EmailDeliveryIdSchema.make(
      `${sharedLongPrefix}first`
    );
    const secondPriorDeliveryId = EmailDeliveryIdSchema.make(
      `${sharedLongPrefix}second`
    );

    const firstKey =
      createCustomerEmailRecoveryIdempotencyKey(firstPriorDeliveryId);
    const secondKey = createCustomerEmailRecoveryIdempotencyKey(
      secondPriorDeliveryId
    );

    const legacyTruncationLength =
      `workspace-paid-reservation-access-recovery-${firstPriorDeliveryId}`
        .length;
    expect(legacyTruncationLength).toBeGreaterThan(256);
    expect(firstKey).toMatch(
      /^workspace-paid-reservation-access-recovery-[0-9a-f]{64}$/
    );
    expect(firstKey.length).toBeLessThanOrEqual(256);
    expect(secondKey.length).toBeLessThanOrEqual(256);
    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).toBe(
      createCustomerEmailRecoveryIdempotencyKey(firstPriorDeliveryId)
    );
    expect(secondKey).toBe(
      createCustomerEmailRecoveryIdempotencyKey(secondPriorDeliveryId)
    );
  });
});
