import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import type {
  CheckoutStatusViewModel,
  ICheckoutStatusService,
} from "./checkout-status.service";
import { loadCheckoutStatusPage } from "./checkout-status-page.server";

const input = {
  orderId: "order-id",
  returnOutcome: "success",
} as const;
const fulfilledStatus = {
  orderId: input.orderId,
  status: "fulfilled",
} as CheckoutStatusViewModel;

test("falls back to authoritative local status after a page refresh read fails", async () => {
  const refreshStatus = mock(() =>
    Effect.fail(new Error("refresh read failed"))
  ) as ICheckoutStatusService["refreshStatus"];
  const getStatus = mock(() => Effect.succeed(fulfilledStatus));

  const result = await Effect.runPromise(
    loadCheckoutStatusPage({ getStatus, refreshStatus }, input)
  );

  expect(result).toBe(fulfilledStatus);
  expect(refreshStatus).toHaveBeenCalledTimes(1);
  expect(getStatus).toHaveBeenCalledTimes(1);
  expect(getStatus).toHaveBeenCalledWith(input);
});

test("preserves a local status read failure after the refresh fallback", async () => {
  const refreshStatus = mock(() =>
    Effect.fail(new Error("refresh read failed"))
  ) as ICheckoutStatusService["refreshStatus"];
  const getStatus = mock(() =>
    Effect.fail(new Error("local read failed"))
  ) as ICheckoutStatusService["getStatus"];

  await expect(
    Effect.runPromise(
      loadCheckoutStatusPage({ getStatus, refreshStatus }, input)
    )
  ).rejects.toThrow("local read failed");

  expect(refreshStatus).toHaveBeenCalledTimes(1);
  expect(getStatus).toHaveBeenCalledTimes(1);
});
