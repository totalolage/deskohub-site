import { expect, mock, test } from "bun:test";
import { ExternalAPIError } from "@deskohub/dotypos";
import { Effect } from "effect";
import {
  cleanupCheckoutFlowStates,
  cleanupOwnedCheckoutFlowStates,
} from "./cleanup";
import type { DatasourceConfig } from "./config";
import type { CheckoutData, CheckoutFlowState, CheckoutRow } from "./types";

test("fallback cleanup cancels every matching reservation exactly once", async () => {
  const firstRow = checkoutRow("dotypos-reservation-1");
  const duplicateFirstRow = checkoutRow("dotypos-reservation-1");
  const secondRow = checkoutRow("dotypos-reservation-2");
  const readCleanupCheckoutRows = mock(() =>
    Effect.succeed([firstRow, duplicateFirstRow, secondRow])
  );
  const cancelDotyposReservation = mock(() => Effect.void);
  const data = checkoutData();
  const startedAt = new Date("2026-07-26T12:00:00.000Z");
  const flowStates: CheckoutFlowState[] = [
    { data, startedAt },
    { data, startedAt: new Date(startedAt.getTime() + 1_000) },
  ];

  const cleanupError = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates,
        workflowError: new Error("parallel sibling failed"),
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: () => Effect.succeed(undefined),
        readCleanupCheckoutRows,
        readDotyposReservationOwner: ownerForCheckoutData(data),
      }
    )
  );

  expect(cleanupError).toBeUndefined();
  expect(readCleanupCheckoutRows).toHaveBeenCalledTimes(1);
  expect(cancelDotyposReservation.mock.calls.map(([, id]) => id)).toEqual([
    "dotypos-reservation-1",
    "dotypos-reservation-2",
  ]);
});

test("overlaps cleanup lookups and independent cancellations", async () => {
  const lookupBarrier = makeBarrier<CheckoutRow | readonly CheckoutRow[]>(3);
  const cancellationBarrier = makeBarrier<void>(3);
  const data = checkoutData();
  const startedAt = new Date("2026-07-26T12:00:00.000Z");
  const flowStates: CheckoutFlowState[] = [
    { data, orderId: "order-1", startedAt },
    {
      data,
      orderId: "order-2",
      startedAt: new Date(startedAt.getTime() + 1_000),
    },
  ];
  const cancelDotyposReservation = mock(() =>
    cancellationBarrier.wait(undefined)
  );

  const cleanupError = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates,
        workflowError: undefined,
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: (orderId) =>
          lookupBarrier.wait(
            checkoutRow(
              orderId === "order-1"
                ? "dotypos-reservation-1"
                : "dotypos-reservation-2",
              orderId
            )
          ),
        readCleanupCheckoutRows: () =>
          lookupBarrier.wait([checkoutRow("dotypos-reservation-3")]),
        readDotyposReservationOwner: ownerForCheckoutData(data),
      }
    )
  );

  expect(cleanupError).toBeUndefined();
  expect(lookupBarrier.maximumActive()).toBe(3);
  expect(cancellationBarrier.maximumActive()).toBe(3);
  expect(cancelDotyposReservation).toHaveBeenCalledTimes(3);
});

test("fails closed on lookup errors before checkout cancellation", async () => {
  const cancelDotyposReservation = mock(() =>
    Effect.fail(new Error("cancellation failed"))
  );
  const data = checkoutData();
  const startedAt = new Date("2026-07-26T12:00:00.000Z");
  const flowStates: CheckoutFlowState[] = [
    { checkoutRow: checkoutRow("dotypos-reservation-1"), data },
    { checkoutRow: checkoutRow("dotypos-reservation-2"), data },
    { data, orderId: "order-1", startedAt },
    {
      data,
      orderId: "order-2",
      startedAt: new Date(startedAt.getTime() + 1_000),
    },
  ];

  const cleanupError = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates,
        workflowError: new Error("workflow failed"),
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: () => Effect.fail(new Error("row lookup failed")),
        readCleanupCheckoutRows: () =>
          Effect.fail(new Error("fallback lookup failed")),
        readDotyposReservationOwner: ownerForCheckoutData(data),
      }
    )
  );

  expect(cleanupError).toBeDefined();
  expect(cancelDotyposReservation).not.toHaveBeenCalled();
});

test("does not cancel order or fallback rows outside their journaled recipient", async () => {
  const cancelledReservationIds: string[] = [];
  const foreignRow = checkoutRow(
    "dotypos-reservation-foreign",
    "journaled-order"
  );
  const cancelDotyposReservation = mock((_config, id: string) => {
    cancelledReservationIds.push(id);
    return Effect.void;
  });
  const exactOrderState: CheckoutFlowState = {
    data: checkoutData(),
    orderId: "journaled-order" as CheckoutFlowState["orderId"],
    startedAt: new Date("2026-07-26T12:00:00.000Z"),
  };

  const exactCleanupError = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates: [exactOrderState],
        workflowError: undefined,
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: () => Effect.succeed(foreignRow),
        readCleanupCheckoutRows: () => Effect.succeed([]),
        readDotyposReservationOwner: () =>
          Effect.succeed({
            customerId:
              "dotypos-customer-1" as CheckoutRow["dotypos_customer_id"],
            email: "delivered+other-run@resend.dev",
          }),
      }
    )
  );
  expect(exactCleanupError?.message).toContain("recipient ownership mismatch");

  const fallbackState: CheckoutFlowState = {
    data: { ...checkoutData(), locale: "cs-CZ" },
    startedAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const fallbackCleanupError = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates: [fallbackState],
        workflowError: undefined,
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: () => Effect.succeed(undefined),
        readCleanupCheckoutRows: () => Effect.succeed([foreignRow]),
        readDotyposReservationOwner: () =>
          Effect.succeed({
            customerId:
              "dotypos-customer-1" as CheckoutRow["dotypos_customer_id"],
            email: "delivered+other-run@resend.dev",
          }),
      }
    )
  );
  expect(fallbackCleanupError?.message).toContain(
    "recipient ownership mismatch"
  );

  expect(cancelledReservationIds).toEqual([]);
});

test("validates ownership of a captured reservation before checkout cancellation", async () => {
  const cancelDotyposReservation = mock(() => Effect.void);
  const state: CheckoutFlowState = {
    checkoutRow: checkoutRow("captured-reservation", "captured-order"),
    data: checkoutData(),
  };

  const cleanupError = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates: [state],
        workflowError: undefined,
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: () => Effect.succeed(undefined),
        readCleanupCheckoutRows: () => Effect.succeed([]),
        readDotyposReservationOwner: () =>
          Effect.succeed({
            customerId:
              "dotypos-customer-1" as CheckoutRow["dotypos_customer_id"],
            email: "delivered+other-run@resend.dev",
          }),
      }
    )
  );

  expect(cleanupError?.message).toContain("recipient ownership mismatch");
  expect(cancelDotyposReservation).not.toHaveBeenCalled();
});

test("treats only a missing reservation as already converged during cleanup", async () => {
  const datasourceConfig = {} as DatasourceConfig;
  const state: CheckoutFlowState = {
    checkoutRow: checkoutRow("missing-reservation"),
    data: checkoutData(),
    startedAt: new Date("2026-08-04T12:00:00.000Z"),
  };
  const cancelDotyposReservation = mock(() => Effect.void);
  const waitForCancelledDotyposReservations = mock(() => Effect.void);
  const missingReservationError = new ExternalAPIError({
    operation: "getReservation",
    service: "Dotypos",
    statusCode: 404,
  });

  const missingReservationResult = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig,
        flowStates: [state],
        workflowError: undefined,
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: () => Effect.succeed(undefined),
        readCleanupCheckoutRows: () => Effect.succeed([]),
        readDotyposReservationOwner: () => Effect.fail(missingReservationError),
        waitForCancelledDotyposReservations,
      }
    )
  );

  expect(missingReservationResult).toBeUndefined();
  expect(cancelDotyposReservation).not.toHaveBeenCalled();
  expect(waitForCancelledDotyposReservations).toHaveBeenCalledWith(
    datasourceConfig,
    ["missing-reservation"],
    {
      endDate: new Date("2026-08-04T22:00:00.000Z"),
      startDate: new Date("2026-08-03T22:00:00.000Z"),
    }
  );

  const customerNotFoundError = new ExternalAPIError({
    operation: "getCustomer",
    service: "Dotypos",
    statusCode: 404,
  });
  const customerNotFoundResult = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig,
        flowStates: [state],
        workflowError: undefined,
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: () => Effect.succeed(undefined),
        readCleanupCheckoutRows: () => Effect.succeed([]),
        readDotyposReservationOwner: () => Effect.fail(customerNotFoundError),
        waitForCancelledDotyposReservations,
      }
    )
  );

  expect(customerNotFoundResult).toBeDefined();
  expect(cancelDotyposReservation).not.toHaveBeenCalled();
  expect(waitForCancelledDotyposReservations).toHaveBeenCalledTimes(1);
});

test("case-owned cleanup uses only captured IDs and exact-order lookups", async () => {
  const cancellationBarrier = makeBarrier<void>(3);
  const capturedState: CheckoutFlowState = {
    checkoutRow: checkoutRow("dotypos-reservation-1"),
    data: checkoutData(),
    startedAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const exactOrderState: CheckoutFlowState = {
    data: checkoutData(),
    orderId: "order-2",
    startedAt: new Date("2026-07-26T12:00:01.000Z"),
  };
  const secondCapturedState: CheckoutFlowState = {
    checkoutRow: checkoutRow("dotypos-reservation-3"),
    data: checkoutData(),
    startedAt: new Date("2026-07-26T12:00:02.000Z"),
  };
  const unresolvedInterruptedState: CheckoutFlowState = {
    data: checkoutData(),
    startedAt: new Date("2026-07-26T12:00:03.000Z"),
  };
  const readCheckoutRow = mock(() =>
    Effect.succeed(checkoutRow("dotypos-reservation-2"))
  );

  const cleanupError = await Effect.runPromise(
    cleanupOwnedCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates: [
          capturedState,
          exactOrderState,
          secondCapturedState,
          unresolvedInterruptedState,
        ],
        workflowError: new Error("sibling interrupted"),
      },
      {
        cancelDotyposReservation: () => cancellationBarrier.wait(undefined),
        readCheckoutRow,
      }
    )
  );

  expect(cleanupError).toBeUndefined();
  expect(readCheckoutRow).toHaveBeenCalledTimes(1);
  expect(cancellationBarrier.maximumActive()).toBe(3);
  expect(capturedState.cleanupComplete).toBe(true);
  expect(capturedState.completedDotyposReservationId).toBe(
    "dotypos-reservation-1"
  );
  expect(exactOrderState.cleanupComplete).toBe(true);
  expect(secondCapturedState.cleanupComplete).toBe(true);
  expect(unresolvedInterruptedState.cleanupComplete).toBeUndefined();
});

test("does not cancel a journaled case reservation twice", async () => {
  const state: CheckoutFlowState = {
    cleanupComplete: true,
    completedDotyposReservationId: "dotypos-reservation-1",
    data: checkoutData(),
    startedAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const cancelDotyposReservation = mock(() => Effect.void);
  const waitForCancelledDotyposReservations = mock(() => Effect.void);

  const cleanupError = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates: [state],
        workflowError: undefined,
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: () => Effect.succeed(undefined),
        readCleanupCheckoutRows: () =>
          Effect.succeed([checkoutRow("dotypos-reservation-1")]),
        waitForCancelledDotyposReservations,
        readDotyposReservationOwner: ownerForCheckoutData(checkoutData()),
      }
    )
  );

  expect(cleanupError).toBeUndefined();
  expect(cancelDotyposReservation).not.toHaveBeenCalled();
  expect(waitForCancelledDotyposReservations).toHaveBeenCalledTimes(1);
});

test("case-owned cleanup leaves failed cancellations for suite reconciliation", async () => {
  const state: CheckoutFlowState = {
    checkoutRow: checkoutRow("dotypos-reservation-1"),
    data: checkoutData(),
  };

  const cleanupError = await Effect.runPromise(
    cleanupOwnedCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates: [state],
        workflowError: undefined,
      },
      {
        cancelDotyposReservation: () =>
          Effect.fail(new Error("cancellation failed")),
        readCheckoutRow: () => Effect.succeed(undefined),
      }
    )
  );

  expect(cleanupError).toBeDefined();
  expect(state.cleanupComplete).toBeUndefined();
});

test("waits for case cancellations to leave active inventory", async () => {
  const state: CheckoutFlowState = {
    checkoutRow: checkoutRow("dotypos-reservation-1"),
    cleanupComplete: true,
    data: checkoutData(),
  };
  const cancelDotyposReservation = mock(() => Effect.void);
  const waitForCancelledDotyposReservations = mock(() => Effect.void);

  const cleanupError = await Effect.runPromise(
    cleanupCheckoutFlowStates(
      {
        datasourceConfig: {} as DatasourceConfig,
        flowStates: [state],
        workflowError: undefined,
      },
      {
        cancelDotyposReservation,
        readCheckoutRow: () => Effect.succeed(undefined),
        readCleanupCheckoutRows: () => Effect.succeed([]),
        waitForCancelledDotyposReservations,
        readDotyposReservationOwner: ownerForCheckoutData(state.data),
      }
    )
  );

  expect(cleanupError).toBeUndefined();
  expect(cancelDotyposReservation).not.toHaveBeenCalled();
  expect(waitForCancelledDotyposReservations).toHaveBeenCalledWith(
    {},
    ["dotypos-reservation-1"],
    {
      endDate: new Date("2026-08-04T22:00:00.000Z"),
      startDate: new Date("2026-08-03T22:00:00.000Z"),
    }
  );
});

const checkoutData = () =>
  ({
    date: "2026-08-04",
    email: "delivered+synthetic-checkout@resend.dev",
    expectedReservationDetails: {
      kind: "cowork",
      entryTier: "basic",
      coffee: false,
    },
    locale: "en-US",
  }) as CheckoutData;

const checkoutRow = (dotyposReservationId: string, reservationId = "order-1") =>
  ({
    reservation_id: reservationId,
    dotypos_customer_id: "dotypos-customer-1" as NonNullable<
      CheckoutRow["dotypos_customer_id"]
    >,
    dotypos_reservation_id: dotyposReservationId,
  }) as CheckoutRow;

const ownerForCheckoutData =
  (data: CheckoutData) =>
  (
    _config: DatasourceConfig,
    _reservationId: CheckoutRow["dotypos_reservation_id"]
  ) =>
    Effect.succeed({
      customerId: "dotypos-customer-1" as NonNullable<
        CheckoutRow["dotypos_customer_id"]
      >,
      email: data.email,
    });

const makeBarrier = <A>(expectedParticipants: number) => {
  let active = 0;
  let maximumActive = 0;
  let started = 0;
  let release: () => void = () => undefined;
  const allStarted = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    maximumActive: () => maximumActive,
    wait: (value: A) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          active += 1;
          started += 1;
          maximumActive = Math.max(maximumActive, active);
          if (started === expectedParticipants) release();
        }),
        () => Effect.promise(() => allStarted).pipe(Effect.as(value)),
        () =>
          Effect.sync(() => {
            active -= 1;
          })
      ),
  };
};
