import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  type IReservationAuthorizationService,
  ReservationAuthorizationService,
} from "@/features/reservation/backend/reservation-authorization.service";
import { loadAuthorizedCheckoutStatus } from "./authorized-checkout-status";
import {
  CheckoutStatusService,
  type CheckoutStatusViewModel,
  type ICheckoutStatusService,
} from "./checkout-status.service";

const input = {
  accessCookie: "access-cookie",
  locale: "cs-CZ",
  orderId: "order-id",
  returnOutcome: "success",
} as const;
const fulfilledStatus = {
  orderId: input.orderId,
  status: "fulfilled",
} as CheckoutStatusViewModel;

const load = (
  checkoutStatus: ICheckoutStatusService,
  isAuthorized: IReservationAuthorizationService["isAuthorized"]
) =>
  Effect.runPromise(
    loadAuthorizedCheckoutStatus(input).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(CheckoutStatusService, checkoutStatus),
          Layer.succeed(ReservationAuthorizationService, { isAuthorized })
        )
      )
    )
  );

test("answers the refreshed status of an order the visitor may see", async () => {
  const refreshStatus = mock(() => Effect.succeed(fulfilledStatus));
  const getStatus = mock(() =>
    Effect.fail(new Error("must not read"))
  ) as ICheckoutStatusService["getStatus"];
  const isAuthorized = mock(() => Effect.succeed(true));

  const result = await load({ getStatus, refreshStatus }, isAuthorized);

  expect(result).toBe(fulfilledStatus);
  expect(refreshStatus).toHaveBeenCalledWith({
    orderId: input.orderId,
    returnOutcome: input.returnOutcome,
  });
  expect(getStatus).not.toHaveBeenCalled();
  expect(isAuthorized).toHaveBeenCalledWith({
    accessCookie: input.accessCookie,
    locale: input.locale,
    orderId: input.orderId,
    permission: "view-status",
  });
});

test("falls back to the local status when the refresh fails", async () => {
  const refreshStatus = mock(() =>
    Effect.fail(new Error("refresh read failed"))
  ) as ICheckoutStatusService["refreshStatus"];
  const getStatus = mock(() => Effect.succeed(fulfilledStatus));

  const result = await load(
    { getStatus, refreshStatus },
    mock(() => Effect.succeed(true))
  );

  expect(result).toBe(fulfilledStatus);
  expect(refreshStatus).toHaveBeenCalledTimes(1);
  expect(getStatus).toHaveBeenCalledWith({
    orderId: input.orderId,
    returnOutcome: input.returnOutcome,
  });
});

test("answers not found without reading the status of an order the visitor may not see", async () => {
  const refreshStatus = mock(() =>
    Effect.fail(new Error("must not refresh"))
  ) as ICheckoutStatusService["refreshStatus"];
  const getStatus = mock(() =>
    Effect.fail(new Error("must not read"))
  ) as ICheckoutStatusService["getStatus"];

  const result = await load(
    { getStatus, refreshStatus },
    mock(() => Effect.succeed(false))
  );

  expect(result).toEqual({
    orderId: input.orderId,
    returnOutcome: input.returnOutcome,
    status: "not_found",
  });
  expect(refreshStatus).not.toHaveBeenCalled();
  expect(getStatus).not.toHaveBeenCalled();
});
