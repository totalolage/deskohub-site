import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { mockWorkspaceActionTelemetry } from "@/shared/testing/workspace-action-logging.test-utils";

const { getOperationLogRecords } = await mockWorkspaceActionTelemetry();
const { managePostOrderInvoice } = await import("./manage-post-order-invoice");

describe("managePostOrderInvoice", () => {
  test("keeps the submitted billing address out of telemetry", async () => {
    const orderId = "SYNTHETIC-ORDER-ID";
    const line1 = "Synthetic street 1";

    await expect(
      managePostOrderInvoice({
        locale: "en-US",
        orderId,
        accessToken: "synthetic-access-token",
        operation: "create",
        address: { line1, city: "Prague", postalCode: "100 00", country: "CZ" },
      } as never)
    ).resolves.toEqual({ data: null });

    const records = getOperationLogRecords(
      "accounting.manage-post-order-invoice"
    );
    const actionStart = records.find(
      ({ body }) => body === "Safe action executed"
    );
    expect(actionStart).toBeDefined();
    expect(actionStart?.attributes?.input).toBeUndefined();
    const telemetry = JSON.stringify(records);
    expect(telemetry).not.toContain(orderId);
    expect(telemetry).not.toContain(line1);
  });
});
