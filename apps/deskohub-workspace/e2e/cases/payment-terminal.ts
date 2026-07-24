import { Effect } from "effect";
import {
  clickBrowserElement,
  openBrowserPage,
  switchToMainFrame,
  waitForBrowserReactHydration,
  waitForBrowserText,
  waitForBrowserUrl,
} from "../browser";
import { submitCoworkReservationScript } from "../browser-scripts";
import { startCheckoutPaymentAttempt } from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import {
  assertPaymentTerminalRow,
  markPaymentTerminalForE2E,
  waitForWebhookReplayRow,
} from "../integrations/database";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  PaymentTerminalScenario,
  WorkspaceE2EStepRunner,
} from "../types";
import { makeUrl, setSearchParams } from "../urls";

export const getPaymentTerminalScenarios =
  (): readonly PaymentTerminalScenario[] => [
    {
      providerStatus: "DECLINED",
      state: "failed",
      titlePattern: /Payment was not completed\./i,
    },
    {
      providerStatus: "CANCELLED",
      state: "cancelled",
      titlePattern: /Payment was cancelled\./i,
    },
  ];

export const assertPaymentTerminalPath = ({
  config,
  data,
  datasourceConfig,
  run,
  runStep,
  scenario,
  session,
  state,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  scenario: PaymentTerminalScenario;
  session: string;
  state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: startCheckoutPaymentAttempt({
        config,
        data,
        onOrderId: (startedOrderId) => {
          state.orderId = startedOrderId;
        },
        run,
        session,
        submitReservationScript: submitCoworkReservationScript,
      }),
      id: "start-checkout-payment",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: preparePaymentTerminalState({
        datasourceConfig,
        orderId,
        scenario,
        state,
      }),
      id: `prepare-${scenario.state}-payment-state`,
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: assertTerminalStatusPage({
        config,
        orderId,
        run,
        scenario,
        session,
      }),
      id: `assert-${scenario.state}-status-page`,
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: restartReservation(run, session, scenario, config.timeouts),
      id: "restart-reservation",
      timeoutMs: config.timeouts.uiTransition,
    });

    log(`Payment ${scenario.state} status e2e passed for order ${orderId}`);
  });

const preparePaymentTerminalState = ({
  datasourceConfig,
  orderId,
  scenario,
  state,
}: {
  datasourceConfig: DatasourceConfig;
  orderId: string;
  scenario: PaymentTerminalScenario;
  state: CheckoutFlowState;
}) =>
  Effect.gen(function* () {
    state.checkoutRow = yield* waitForWebhookReplayRow(
      datasourceConfig,
      orderId,
      (row) => {
        state.checkoutRow = row;
      }
    );
    const checkoutRow = yield* markPaymentTerminalForE2E(
      datasourceConfig,
      orderId,
      scenario
    );
    state.checkoutRow = checkoutRow;
    yield* assertPaymentTerminalRow(checkoutRow, scenario);
  });

const restartReservation = (
  run: Runner,
  session: string,
  scenario: PaymentTerminalScenario,
  timeouts: WorkspaceE2ETimeouts
) =>
  Effect.gen(function* () {
    yield* activateStatusReserveAgain(run, session, timeouts);
    yield* waitForBrowserUrl({
      description: `${scenario.state} payment restart page`,
      matches: (url) =>
        (parseUrl(url)?.pathname ?? "") === "/en-US/checkout/order",
      run,
      session,
      timeoutMs: timeouts.uiTransition,
    });
  });

const assertTerminalStatusPage = ({
  config,
  orderId,
  run,
  scenario,
  session,
}: {
  config: WorkspaceE2EConfig;
  orderId: string;
  run: Runner;
  scenario: PaymentTerminalScenario;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* makeUrl(
      "build payment terminal checkout status URL",
      `${config.baseUrl}/en-US/checkout/status/${orderId}`
    );
    yield* setSearchParams(url, { e2eAt: String(Date.now()) });

    yield* switchToMainFrame(run, session);
    yield* openBrowserPage(config, run, session, url.toString(), {
      timeoutMs: 60_000,
    });
    yield* waitForBrowserText({
      description: `${scenario.state} checkout status copy`,
      matches: (text) =>
        scenario.titlePattern.test(text) &&
        /Start a new reservation/i.test(text),
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });

    log(`Checkout ${scenario.state} status page validated`);
  });

export const activateStatusReserveAgain = (
  run: Runner,
  session: string,
  timeouts: WorkspaceE2ETimeouts
) => {
  const selector = 'a[href="/en-US/checkout/order"]';
  const timeoutMs = timeouts.uiTransition;

  return Effect.gen(function* () {
    yield* waitForBrowserReactHydration(run, session, selector, { timeoutMs });
    yield* clickBrowserElement(run, session, selector, { timeoutMs });
  });
};
