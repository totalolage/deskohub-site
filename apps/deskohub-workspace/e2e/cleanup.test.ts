import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { cleanupCheckoutFlowStates } from "./cleanup";
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
