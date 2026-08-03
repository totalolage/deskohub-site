import { expect, mock, test } from "bun:test";
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
                : "dotypos-reservation-2"
            )
          ),
        readCleanupCheckoutRows: () =>
          lookupBarrier.wait([checkoutRow("dotypos-reservation-3")]),
      }
    )
  );

  expect(cleanupError).toBeUndefined();
  expect(lookupBarrier.maximumActive()).toBe(3);
  expect(cancellationBarrier.maximumActive()).toBe(3);
  expect(cancelDotyposReservation).toHaveBeenCalledTimes(3);
});

test("retains every lookup and cancellation error", async () => {
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
      }
    )
  );

  expect(cleanupError?.causes).toHaveLength(5);
  expect(cancelDotyposReservation).toHaveBeenCalledTimes(2);
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
  expect(exactOrderState.cleanupComplete).toBe(true);
  expect(secondCapturedState.cleanupComplete).toBe(true);
  expect(unresolvedInterruptedState.cleanupComplete).toBeUndefined();
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

const checkoutData = () =>
  ({
    expectedReservationDetails: {
      kind: "cowork",
      entryTier: "basic",
      coffee: false,
    },
    locale: "en-US",
  }) as CheckoutData;

const checkoutRow = (dotyposReservationId: string) =>
  ({
    dotypos_reservation_id: dotyposReservationId,
  }) as CheckoutRow;

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
