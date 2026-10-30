import { Effect } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  activateHydratedElement,
  openPage,
  readPageUrl,
  waitForPageCondition,
  waitForPageUrl,
  waitForReactHydration,
} from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EStep, WorkspaceE2EStepRunner } from "../case-runner";
import {
  prepareReservationSelection,
  submitReservationForPayPage,
} from "../checkout/payment";
import {
  isPrefilledReservation,
  toPrefilledReservation,
} from "../checkout/prefilled-reservation";
import type { ReservationFormPreparation } from "../checkout/reservation-form-preparation";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import { tryWorkspaceE2ESync } from "../errors";
import { readCheckoutRow, waitForCheckoutRow } from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import { readDotyposReservationStatus } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { assert, browserSessionFor, log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData, CheckoutFlowState, CheckoutRow } from "../types";

export const assertReservationReplacement = ({
  config,
  data,
  datasourceConfig,
  initialHoldStep,
  toSelectionPreparation,
  replacementData,
  reservationPath,
  run,
  runStep,
  session,
  state,
  toReservationPreparation,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  initialHoldStep?: (row: CheckoutRow) => WorkspaceE2EStep<void>;
  toSelectionPreparation: (data: CheckoutData) => ReservationFormPreparation;
  replacementData: CheckoutData;
  reservationPath: string;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
  state: CheckoutFlowState;
  toReservationPreparation: (data: CheckoutData) => ReservationFormPreparation;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const firstOrderId = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* openPage(browser, config, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (orderId) => {
            state.orderId = orderId;
          },
          preparation: toReservationPreparation(data),
          session: browser,
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
    if (initialHoldStep) {
      yield* runStep(initialHoldStep(firstRow));
    }

    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* returnToPrefilledReservation({
          browser,
          data,
          reservationPath,
          timeouts: config.timeouts,
        });
        yield* editAndReloadRestoredReservation({
          browser,
          config,
          preparation: toSelectionPreparation(replacementData),
          replacementData,
          reservationPath,
        });
      }),
      id: "edit-and-reload-prefilled-reservation",
      timeoutMs: config.timeouts.checkoutStart,
    });
    const secondOrderId = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        return yield* submitReservationForPayPage({
          onOrderId: (orderId) => {
            state.orderId = orderId;
          },
          preparation: toReservationPreparation(replacementData),
          session: browser,
          timeouts: config.timeouts,
        });
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
    state.data = replacementData;
    const cancelledFirstRow = yield* runStep({
      execute: readCheckoutRow(firstOrderId).pipe(
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
  browser,
  data,
  reservationPath,
  timeouts,
}: {
  browser: E2EBrowserSession;
  data: CheckoutData;
  reservationPath: string;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    // The Pay page links back to both reservation steps; the selection step's
    // link carries no `step`.
    const reservationStepSelector = `a[href^="${reservationPath}?payState="]:not([href*="step="])`;
    // Continue renders on the selection step whoever books.
    const selectionStepSelector = "#reservation-continue";
    yield* activateHydratedElement(browser, reservationStepSelector, {
      timeoutMs: timeouts.browserAction,
    });
    yield* waitForPageUrl({
      description: "prefilled reservation page",
      matches: (value) => {
        const url = parseUrl(value);
        return (
          url?.pathname === reservationPath && url.searchParams.has("payState")
        );
      },
      session: browser,
      timeoutMs: timeouts.uiTransition,
    });
    yield* waitForReactHydration(browser, selectionStepSelector, {
      timeoutMs: timeouts.uiTransition,
    });
    yield* waitForPageCondition(
      browser,
      "prefilled reservation fields",
      isPrefilledReservation,
      toPrefilledReservation(data),
      { timeoutMs: timeouts.uiTransition }
    );
  });

/**
 * Edits the restored reservation through the form, then reloads the URL the
 * page wrote. The reload must show the edit while the URL keeps the signed
 * restoration, so the resubmission still replaces the first hold.
 */
const editAndReloadRestoredReservation = ({
  browser,
  config,
  preparation,
  replacementData,
  reservationPath,
}: {
  browser: E2EBrowserSession;
  config: WorkspaceE2EConfig;
  preparation: ReservationFormPreparation;
  replacementData: CheckoutData;
  reservationPath: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const restoredUrl = yield* readPageUrl(browser);
    yield* prepareReservationSelection({
      preparation,
      session: browser,
      timeoutMs: config.timeouts.checkoutStart,
      timeouts: config.timeouts,
    });
    const editedUrl = yield* waitForPageUrl({
      description: "edited selection written beside the restoration",
      matches: (value) => {
        const url = parseUrl(value);
        return (
          value !== restoredUrl &&
          url?.pathname === reservationPath &&
          url.searchParams.has("payState")
        );
      },
      session: browser,
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* openPage(browser, config, editedUrl, {
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* waitForReactHydration(browser, "#reservation-continue", {
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* waitForPageCondition(
      browser,
      "reloaded edit over the restored reservation",
      isPrefilledReservation,
      toPrefilledReservation(replacementData),
      { timeoutMs: config.timeouts.uiTransition }
    );
  });

const readHeldReservation = (
  datasourceConfig: DatasourceConfig,
  orderId: WorkspaceReservationId
): Effect.Effect<CheckoutRow, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const row = yield* waitForCheckoutRow(datasourceConfig, orderId);
    return yield* tryWorkspaceE2ESync("assert held reservation row", () => {
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
  firstOrderId: WorkspaceReservationId;
  firstRow: CheckoutRow;
  firstDotyposStatus: string;
  secondOrderId: WorkspaceReservationId;
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
