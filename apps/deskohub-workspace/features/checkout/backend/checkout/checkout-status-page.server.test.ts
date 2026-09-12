import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import type { IReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import type {
  CheckoutStatusViewModel,
  ICheckoutStatusService,
} from "./checkout-status.service";
import { loadCheckoutStatusPage } from "./checkout-status-page.server";

const input = {
  accessCookie: undefined,
  locale: "en-US",
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
  const isAuthorized = mock(() => Effect.succeed(true));

  const result = await Effect.runPromise(
    loadCheckoutStatusPage(
      { getStatus, refreshStatus },
      { isAuthorized } as IReservationAuthorizationService,
      input
    )
  );

  expect(result).toBe(fulfilledStatus);
  expect(refreshStatus).toHaveBeenCalledTimes(1);
  expect(getStatus).toHaveBeenCalledTimes(1);
  expect(getStatus).toHaveBeenCalledWith({
    orderId: input.orderId,
    returnOutcome: input.returnOutcome,
  });
  expect(isAuthorized).toHaveBeenCalledWith({
    accessCookie: undefined,
    locale: input.locale,
    orderId: input.orderId,
  });
});

test("preserves a local status read failure after the refresh fallback", async () => {
  const refreshStatus = mock(() =>
    Effect.fail(new Error("refresh read failed"))
  ) as ICheckoutStatusService["refreshStatus"];
  const getStatus = mock(() =>
    Effect.fail(new Error("local read failed"))
  ) as ICheckoutStatusService["getStatus"];
  const isAuthorized = mock(() => Effect.succeed(true));

  await expect(
    Effect.runPromise(
      loadCheckoutStatusPage(
        { getStatus, refreshStatus },
        { isAuthorized } as IReservationAuthorizationService,
        input
      )
    )
  ).rejects.toThrow("local read failed");

  expect(refreshStatus).toHaveBeenCalledTimes(1);
  expect(getStatus).toHaveBeenCalledTimes(1);
});

test("does not read checkout status when reservation access is unauthorized", async () => {
  const refreshStatus = mock(() =>
    Effect.fail(new Error("must not refresh"))
  ) as ICheckoutStatusService["refreshStatus"];
  const getStatus = mock(() =>
    Effect.fail(new Error("must not read"))
  ) as ICheckoutStatusService["getStatus"];
  const isAuthorized = mock(() => Effect.succeed(false));

  const result = await Effect.runPromise(
    loadCheckoutStatusPage(
      { getStatus, refreshStatus },
      { isAuthorized } as IReservationAuthorizationService,
      input
    )
  );

  expect(result).toEqual({
    orderId: input.orderId,
    returnOutcome: input.returnOutcome,
    status: "not_found",
  });
  expect(isAuthorized).toHaveBeenCalledTimes(1);
  expect(refreshStatus).not.toHaveBeenCalled();
  expect(getStatus).not.toHaveBeenCalled();
});
