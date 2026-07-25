import { Effect } from "effect";
import {
  fillBrowserField,
  focusBrowserElement,
  openBrowserPage,
  pressBrowserKey,
  waitForBrowserReactFormAction,
  waitForBrowserTextContent,
  waitForBrowserUrl,
} from "../browser";
import {
  submitCheckoutPayment,
  submitReservationForPayPage,
} from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import {
  markConsoleFulfillmentDeliveredForE2E,
  seedZeroTotalDiscountCode,
  validateInternalPostgres,
  ZERO_TOTAL_DISCOUNT_CODE,
} from "../integrations/database";
import { validateDotypos } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { addRedaction, log } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2EStepRunner,
} from "../types";
import { isExpectedCheckoutStatusUrl } from "../urls";
import { assertFulfilledStatusPage } from "./checkout";

export const executeZeroTotalCheckout = ({
  config,
  data,
  datasourceConfig,
  run,
  runStep,
  session,
  state,
  submitReservationScript,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
  readonly submitReservationScript: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    yield* runStep({
      execute: seedZeroTotalDiscountCode(datasourceConfig),
      id: "seed-zero-total-code",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: openBrowserPage(config, run, session, data.checkoutUrl, {
        timeoutMs: config.timeouts.browserNavigation,
      }).pipe(Effect.asVoid),
      id: "open-zero-total-checkout",
      timeoutMs: config.timeouts.browserNavigation,
    });
    const orderId = yield* runStep({
      execute: submitReservationForPayPage({
        onOrderId: (startedOrderId) => {
          state.orderId = startedOrderId;
        },
        run,
        session,
        submitReservationScript,
        timeouts: config.timeouts,
      }),
      id: "prepare-zero-total-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: applyZeroTotalCode(config, run, session),
      id: "apply-zero-total-code",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: submitCheckoutPayment(run, session).pipe(
        Effect.andThen(
          waitForBrowserUrl({
            description: "zero-total checkout status page",
            matches: (url) =>
              isExpectedCheckoutStatusUrl(url, config.expectedHost),
            run,
            session,
            timeoutMs: config.timeouts.providerTransition,
          })
        ),
        Effect.asVoid
      ),
      id: "complete-internal-payment",
      timeoutMs: config.timeouts.providerTransition,
    });
    yield* runStep({
      execute: markConsoleFulfillmentDeliveredForE2E(datasourceConfig, orderId),
      id: "complete-zero-total-fulfillment",
      timeoutMs: config.timeouts.datasource,
    });
    const checkoutRow = yield* runStep({
      execute: validateInternalPostgres(
        datasourceConfig,
        data,
        orderId,
        (row) => {
          state.checkoutRow = row;
        }
      ),
      id: "validate-internal-postgres-state",
      timeoutMs: config.timeouts.datasource,
    });
    state.checkoutRow = checkoutRow;
    yield* runStep({
      execute: assertFulfilledStatusPage({
        config,
        locale: data.locale,
        orderId,
        run,
        session,
      }),
      id: "assert-zero-total-fulfilled-status",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: validateDotypos(datasourceConfig, data, checkoutRow),
      id: "validate-zero-total-dotypos",
      timeoutMs: config.timeouts.datasource,
    });
    log(`zero-total checkout e2e passed for order ${orderId}`);
  });

const applyZeroTotalCode = (
  config: WorkspaceE2EConfig,
  run: Runner,
  session: string
) =>
  Effect.gen(function* () {
    addRedaction(ZERO_TOTAL_DISCOUNT_CODE, true);
    yield* waitForBrowserReactFormAction(
      run,
      session,
      "#checkout-discount-code-form",
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* fillBrowserField(
      run,
      session,
      "#checkout-discount-code",
      ZERO_TOTAL_DISCOUNT_CODE,
      { timeoutMs: config.timeouts.browserAction }
    );
    yield* focusBrowserElement(
      run,
      session,
      '#checkout-discount-code-form button[type="submit"]',
      { timeoutMs: config.timeouts.browserAction }
    );
    yield* pressBrowserKey(run, session, "Enter", {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* waitForBrowserTextContent(
      run,
      session,
      "Discount code applied: 100% off 🎉",
      { timeoutMs: config.timeouts.uiTransition }
    );
  });
