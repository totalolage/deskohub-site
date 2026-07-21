import { Effect } from "effect";
import {
  clickBrowserRef,
  evalBrowserScript,
  openBrowserPage,
  requireSnapshotRef,
  waitForBrowserReactHydration,
  waitForBrowserUrl,
} from "../browser";
import {
  getAssertPrefilledReservationScript,
  submitCoworkReservationScript,
} from "../browser-scripts";
import { submitReservationForPayPage } from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import { tryWorkspaceE2ESync } from "../errors";
import { readCheckoutRow } from "../integrations/database";
import type { Runner } from "../runtime";
import { assert, log, parseUrl } from "../runtime";
import { getWorkspaceE2ETimeoutMs } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  CheckoutRow,
  WorkspaceE2EStepRunner,
} from "../types";

export const assertReservationReuse = ({
  config,
  data,
  datasourceConfig,
  run,
  runStep,
  session,
  state,
  unexpectedReservationState,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
  state: CheckoutFlowState;
  unexpectedReservationState: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const firstOrderId = yield* runStep({
      execute: Effect.gen(function* () {
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: getWorkspaceE2ETimeoutMs("browserNavigation"),
        });
        return yield* submitReservationForPayPage({
          onOrderId: (orderId) => {
            state.orderId = orderId;
          },
          run,
          session,
          submitReservationScript: submitCoworkReservationScript,
        });
      }),
      id: "prepare-reservation-hold",
      timeoutMs: getWorkspaceE2ETimeoutMs("checkoutStart"),
    });
    state.orderId = firstOrderId;

    const firstRow = yield* runStep({
      execute: readHeldReservation(datasourceConfig, firstOrderId),
      id: "read-initial-reservation-hold",
      timeoutMs: getWorkspaceE2ETimeoutMs("datasource"),
    });
    state.checkoutRow = firstRow;

    yield* runStep({
      execute: returnToPrefilledReservation({ data, run, session }),
      id: "return-to-prefilled-reservation",
      timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition"),
    });

    const secondOrderId = yield* runStep({
      execute: submitReservationForPayPage({
        onOrderId: (orderId) => {
          if (orderId !== firstOrderId) {
            unexpectedReservationState.orderId = orderId;
          }
        },
        run,
        session,
        submitReservationScript: submitCoworkReservationScript,
      }),
      id: "resubmit-unchanged-reservation",
      timeoutMs: getWorkspaceE2ETimeoutMs("checkoutStart"),
    });
    const secondRow = yield* runStep({
      execute: readHeldReservation(datasourceConfig, secondOrderId),
      id: "assert-reservation-hold-reused",
      timeoutMs: getWorkspaceE2ETimeoutMs("datasource"),
    });
    if (secondOrderId === firstOrderId) {
      state.checkoutRow = secondRow;
    } else {
      unexpectedReservationState.checkoutRow = secondRow;
    }

    yield* assertSameReservation({
      firstOrderId,
      firstRow,
      secondOrderId,
      secondRow,
    });
    log(`Reservation reuse e2e passed for order ${firstOrderId}`);
  });

const returnToPrefilledReservation = ({
  data,
  run,
  session,
}: {
  data: CheckoutData;
  run: Runner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const reservationStepRef = yield* requireSnapshotRef({
      description: "reservation checkout step",
      labels: ["Reservation", "Rezervace"],
      run,
      session,
    });
    yield* clickBrowserRef(
      "click reservation checkout step",
      run,
      session,
      reservationStepRef,
      { timeoutMs: getWorkspaceE2ETimeoutMs("browserAction") }
    );
    yield* waitForBrowserUrl({
      description: "prefilled reservation page",
      matches: (value) => {
        const url = parseUrl(value);
        return (
          url?.pathname === `/${data.locale}/checkout/order` &&
          url.searchParams.has("payState")
        );
      },
      run,
      session,
      timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition"),
    });
    yield* waitForBrowserReactHydration(
      run,
      session,
      "#reservation-privacy-consent",
      { timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition") }
    );
    yield* evalBrowserScript(
      "assert prefilled reservation fields",
      run,
      session,
      getAssertPrefilledReservationScript(data),
      {
        logOutput: false,
        timeoutMs: getWorkspaceE2ETimeoutMs("browserAction"),
      }
    );
  });

const readHeldReservation = (
  datasourceConfig: DatasourceConfig,
  orderId: string
): Effect.Effect<CheckoutRow, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const row = yield* readCheckoutRow(datasourceConfig, orderId);
    return yield* tryWorkspaceE2ESync("assert held reservation row", () => {
      assert(row, "held reservation row missing");
      assert(
        row.reservation_state === "held",
        "reservation was not held before payment"
      );
      assert(
        row.payment_state === "not_started",
        "reservation payment started before pay submission"
      );
      assert(row.dotypos_reservation_id, "held reservation Dotypos id missing");
      return row;
    });
  });

const assertSameReservation = ({
  firstOrderId,
  firstRow,
  secondOrderId,
  secondRow,
}: {
  firstOrderId: string;
  firstRow: CheckoutRow;
  secondOrderId: string;
  secondRow: CheckoutRow;
}): Effect.Effect<void, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("assert reservation hold reused", () => {
    assert(
      secondOrderId === firstOrderId,
      "unchanged reservation created a different workspace reservation"
    );
    assert(
      secondRow.reservation_id === firstRow.reservation_id,
      "unchanged reservation persisted a different reservation row"
    );
    assert(
      secondRow.dotypos_reservation_id === firstRow.dotypos_reservation_id,
      "unchanged reservation created a different Dotypos hold"
    );
  });
