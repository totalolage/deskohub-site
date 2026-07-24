import { Effect } from "effect";
import {
  activateBrowserElement,
  evalBrowserScript,
  openBrowserPage,
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
import { readDotyposReservationStatus } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { assert, log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  CheckoutRow,
  WorkspaceE2EStepRunner,
} from "../types";

export const assertReservationReplacement = ({
  config,
  data,
  datasourceConfig,
  run,
  runStep,
  session,
  state,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
  state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const firstOrderId = yield* runStep({
      execute: Effect.gen(function* () {
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (orderId) => {
            state.orderId = orderId;
          },
          run,
          session,
          submitReservationScript: submitCoworkReservationScript,
          timeouts: config.timeouts,
        });
      }),
      id: "prepare-reservation-hold",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = firstOrderId;

    const firstRow = yield* runStep({
      execute: readHeldReservation(datasourceConfig, firstOrderId),
      id: "read-initial-reservation-hold",
      timeoutMs: config.timeouts.datasource,
    });
    state.checkoutRow = firstRow;
    const firstDotyposReservationId = yield* tryWorkspaceE2ESync(
      "read initial Dotypos reservation id",
      () => {
        assert(firstRow.dotypos_reservation_id, "initial Dotypos id missing");
        return firstRow.dotypos_reservation_id;
      }
    );

    yield* runStep({
      execute: returnToPrefilledReservation({
        data,
        run,
        session,
        timeouts: config.timeouts,
      }),
      id: "return-to-prefilled-reservation",
      timeoutMs: config.timeouts.uiTransition,
    });
    const secondOrderId = yield* runStep({
      execute: submitReservationForPayPage({
        onOrderId: (orderId) => {
          state.orderId = orderId;
        },
        run,
        session,
        submitReservationScript: submitCoworkReservationScript,
        timeouts: config.timeouts,
      }),
      id: "resubmit-prefilled-reservation",
      timeoutMs: config.timeouts.checkoutStart,
    });
    const secondRow = yield* runStep({
      execute: readHeldReservation(datasourceConfig, secondOrderId),
      id: "read-replacement-reservation-hold",
      timeoutMs: config.timeouts.datasource,
    });
    const secondDotyposReservationId = yield* tryWorkspaceE2ESync(
      "read replacement Dotypos reservation id",
      () => {
        assert(
          secondRow.dotypos_reservation_id,
          "replacement Dotypos id missing"
        );
        return secondRow.dotypos_reservation_id;
      }
    );
    state.orderId = secondOrderId;
    state.checkoutRow = secondRow;
    const cancelledFirstRow = yield* runStep({
      execute: readCheckoutRow(datasourceConfig, firstOrderId).pipe(
        Effect.flatMap((row) =>
          tryWorkspaceE2ESync("assert superseded reservation row", () => {
            assert(row, "superseded reservation row missing");
            return row;
          })
        )
      ),
      id: "read-superseded-reservation",
      timeoutMs: config.timeouts.datasource,
    });
    const firstDotyposStatus = yield* runStep({
      execute: readDotyposReservationStatus(
        datasourceConfig,
        firstDotyposReservationId
      ),
      id: "read-superseded-dotypos-status",
      timeoutMs: config.timeouts.datasource,
    });
    const secondDotyposStatus = yield* runStep({
      execute: readDotyposReservationStatus(
        datasourceConfig,
        secondDotyposReservationId
      ),
      id: "read-replacement-dotypos-status",
      timeoutMs: config.timeouts.datasource,
    });

    yield* assertReplacedReservation({
      firstOrderId,
      firstRow: cancelledFirstRow,
      firstDotyposStatus,
      secondOrderId,
      secondRow,
      secondDotyposStatus,
    });
    log(`Reservation replacement e2e passed for order ${secondOrderId}`);
  });

const returnToPrefilledReservation = ({
  data,
  run,
  session,
  timeouts,
}: {
  data: CheckoutData;
  run: Runner;
  session: string;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const reservationStepSelector = `a[href^="/${data.locale}/checkout/order?payState="]`;
    const browserActionTimeoutMs = timeouts.browserAction;
    yield* waitForBrowserReactHydration(
      run,
      session,
      reservationStepSelector,
      { timeoutMs: browserActionTimeoutMs }
    );
    yield* activateBrowserElement(run, session, reservationStepSelector, {
      timeoutMs: browserActionTimeoutMs,
    });
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
      timeoutMs: timeouts.uiTransition,
    });
    yield* waitForBrowserReactHydration(
      run,
      session,
      "#reservation-privacy-consent",
      { timeoutMs: timeouts.uiTransition }
    );
    yield* evalBrowserScript(
      "assert prefilled reservation fields",
      run,
      session,
      getAssertPrefilledReservationScript(data),
      {
        logOutput: false,
        timeoutMs: timeouts.browserAction,
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

const assertReplacedReservation = ({
  firstOrderId,
  firstRow,
  firstDotyposStatus,
  secondOrderId,
  secondRow,
  secondDotyposStatus,
}: {
  firstOrderId: string;
  firstRow: CheckoutRow;
  firstDotyposStatus: string;
  secondOrderId: string;
  secondRow: CheckoutRow;
  secondDotyposStatus: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("assert reservation hold replaced", () => {
    assert(
      secondOrderId !== firstOrderId,
      "deliberate resubmission reused the previous workspace reservation"
    );
    assert(
      secondRow.reservation_id !== firstRow.reservation_id,
      "deliberate resubmission reused the previous reservation row"
    );
    assert(
      secondRow.dotypos_reservation_id !== firstRow.dotypos_reservation_id,
      "deliberate resubmission reused the previous Dotypos hold"
    );
    assert(
      secondRow.checkout_session_key === firstRow.checkout_session_key,
      "replacement reservation did not remain in the checkout session"
    );
    assert(
      secondRow.checkout_attempt_key !== firstRow.checkout_attempt_key,
      "replacement reservation reused the previous checkout attempt"
    );
    assert(
      firstRow.reservation_state === "cancelled",
      "superseded local reservation was not cancelled"
    );
    assert(
      firstRow.payment_state === "not_started",
      "superseded reservation unexpectedly started payment"
    );
    assert(
      firstRow.reservation_cancelled_at,
      "superseded local reservation has no cancellation timestamp"
    );
    assert(
      firstDotyposStatus === "CANCELLED",
      "superseded Dotypos reservation was not cancelled"
    );
    assert(
      secondDotyposStatus === "NEW",
      "replacement Dotypos reservation is not pending"
    );
  });
