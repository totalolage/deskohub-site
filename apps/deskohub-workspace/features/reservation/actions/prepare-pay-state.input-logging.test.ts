import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { mockWorkspaceActionTelemetry } from "@/shared/testing/workspace-action-logging.test-utils";

const { getOperationLogRecords } = await mockWorkspaceActionTelemetry();
const { preparePayState } = await import("./prepare-pay-state");

describe("preparePayState", () => {
  test("keeps the submitted customer contact out of telemetry", async () => {
    const checkoutSessionId = "SYNTHETIC-CHECKOUT-SESSION";
    const email = testEmailAddress("synthetic.customer");

    await expect(
      preparePayState({
        locale: "en-US",
        checkoutSessionId,
        checkoutAttemptId: "synthetic-checkout-attempt",
        advertisedPriceToken: "synthetic-advertised-price-token",
        reservation: {
          kind: "cowork",
          entryTier: "open-space",
          date: "2099-07-01",
          coffee: false,
          name: "Synthetic Customer",
          email,
          phone: "+420 777 777 777",
          billing: { purpose: "personal", invoice: "none" },
        },
      } as never)
    ).resolves.toEqual({ data: null });

    const records = getOperationLogRecords("checkout.prepare-pay-state");
    const actionStart = records.find(
      ({ body }) => body === "Safe action executed"
    );
    expect(actionStart).toBeDefined();
    expect(actionStart?.attributes?.input).toBeUndefined();
    const telemetry = JSON.stringify(records);
    expect(telemetry).not.toContain(checkoutSessionId);
    expect(telemetry).not.toContain(email);
  });
});
